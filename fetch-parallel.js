#!/usr/bin/env node
/**
 * fetch-parallel.js — 并行抓取多篇文章正文
 *
 * 输入：latest-news.json (含 articles[].url)
 * 输出：/tmp/ai-daily-fetched.json
 *       格式：[ { idx, url, text, error } ]
 *
 * 用法：
 *   node fetch-parallel.js [input.json] [--concurrency=N] [--out=/tmp/xxx.json]
 *   默认：input=latest-news.json, concurrency=6, out=/tmp/ai-daily-fetched.json
 */

const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { URL } = require('url');

// ── 参数解析 ────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const inputFile  = args.find(a => !a.startsWith('--')) ||
                   path.join(__dirname, 'latest-news.json');
const concurrency = parseInt((args.find(a => a.startsWith('--concurrency=')) || '').split('=')[1] || '6', 10);
const outFile     = (args.find(a => a.startsWith('--out=')) || '').split('=')[1] ||
                   '/tmp/ai-daily-fetched.json';
const TIMEOUT_MS  = 12000;

// ── HTML → 纯文本提取 ───────────────────────────────────────────────────────
function extractText(html) {
  // 1. 先尝试提取 <article> / <main> / [class*=content] 主体区域
  const mainMatch =
    html.match(/<article[\s\S]*?<\/article>/i) ||
    html.match(/<main[\s\S]*?<\/main>/i) ||
    html.match(/<div[^>]+class="[^"]*(?:article|post|content|story|body)[^"]*"[\s\S]*?<\/div>/i);
  const src = mainMatch ? mainMatch[0] : html;

  return src
    // 删除 script/style/nav/footer/aside
    .replace(/<(script|style|nav|footer|aside|header|noscript|iframe|figure)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // 删除注释
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // 段落/标题换行
    .replace(/<\/(p|h[1-6]|li|blockquote|div)>/gi, '\n')
    // 删除剩余标签
    .replace(/<[^>]+>/g, ' ')
    // HTML 实体
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    // 清理多余空白
    .split('\n').map(l => l.trim()).filter(l => l.length > 20).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 10000)  // 最多 10KB 给 AI
    .trim();
}

// ── 单个 URL 抓取（含重定向、超时） ──────────────────────────────────────────
function fetchUrl(url, depth = 0) {
  return new Promise(resolve => {
    if (depth > 3) return resolve({ url, error: 'too many redirects', text: '' });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      resolve({ url, error: 'timeout', text: '' });
    }, TIMEOUT_MS);

    const proto   = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
                      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                      'Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      },
    };

    try {
      const req = proto.get(url, options, res => {
        if (timedOut) return;

        // 重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          clearTimeout(timer);
          const next = new URL(res.headers.location, url).href;
          fetchUrl(next, depth + 1).then(resolve);
          return;
        }

        if (res.statusCode !== 200) {
          clearTimeout(timer);
          return resolve({ url, error: `HTTP ${res.statusCode}`, text: '' });
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          if (timedOut) return;
          clearTimeout(timer);
          const html = Buffer.concat(chunks).toString('utf8');
          resolve({ url, text: extractText(html), error: null });
        });
        res.on('error', e => {
          clearTimeout(timer);
          resolve({ url, error: e.message, text: '' });
        });
      });

      req.on('error', e => {
        if (timedOut) return;
        clearTimeout(timer);
        resolve({ url, error: e.message, text: '' });
      });
    } catch (e) {
      clearTimeout(timer);
      resolve({ url, error: e.message, text: '' });
    }
  });
}

// ── 并发控制：分批 Promise.all ───────────────────────────────────────────────
async function fetchAll(items, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch    = items.slice(i, i + concurrency);
    const t0       = Date.now();
    const batchRes = await Promise.all(batch.map(item => fetchUrl(item.url)));
    const elapsed  = ((Date.now() - t0) / 1000).toFixed(1);
    const ok       = batchRes.filter(r => !r.error).length;
    console.error(
      `  batch ${Math.floor(i / concurrency) + 1} (${batch.length} URLs): ` +
      `${ok} ok, ${batch.length - ok} failed — ${elapsed}s`
    );
    results.push(...batchRes.map((r, j) => ({ ...r, idx: batch[j].idx })));
  }
  return results;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const raw   = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  const items = (raw.articles || raw).map((a, i) => ({
    idx: i,
    url: a.best_url || a.url,
  }));

  console.error(`fetch-parallel: ${items.length} URLs, concurrency=${concurrency}`);
  const t0      = Date.now();
  const results = await fetchAll(items, concurrency);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const ok      = results.filter(r => !r.error).length;
  console.error(`done: ${ok}/${items.length} succeeded in ${elapsed}s`);

  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(outFile);  // 把输出路径打到 stdout 方便调用方读取
}

main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
