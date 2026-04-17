#!/usr/bin/env node
/**
 * parallel.js — 并行抓取文章 URL 的正文，原地给每条加 body_text 字段
 *
 * Input:  tmp/merged.json（数组，每项有 url/best_url）
 * Output: 同一文件（原地写回，给每条加 body_text），除非 --out 指定
 *
 * 用法：
 *   node src/fetch/parallel.js                        # in-place 增强 tmp/merged.json
 *   node src/fetch/parallel.js tmp/foo.json           # 换输入
 *   node src/fetch/parallel.js --concurrency=8 --out=tmp/merged-bodies.json
 *
 * 失败的条目 body_text 留空字符串，不影响 agent 继续用 content/snippet 做判断。
 */
'use strict';
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { URL } = require('url');

const args        = process.argv.slice(2);
const ROOT        = path.resolve(__dirname, '../..');
const argVal      = (flag, dflt) => {
  const a = args.find(x => x.startsWith(`${flag}=`));
  return a ? a.split('=')[1] : dflt;
};
const inputFile   = args.find(a => !a.startsWith('--')) || path.join(ROOT, 'tmp', 'merged.json');
const outFile     = argVal('--out', inputFile);  // default: in-place
const concurrency = parseInt(argVal('--concurrency', '6'), 10);
const TIMEOUT_MS  = 12000;

function extractText(html) {
  const mainMatch =
    html.match(/<article[\s\S]*?<\/article>/i) ||
    html.match(/<main[\s\S]*?<\/main>/i) ||
    html.match(/<div[^>]+class="[^"]*(?:article|post|content|story|body)[^"]*"[\s\S]*?<\/div>/i);
  const src = mainMatch ? mainMatch[0] : html;

  return src
    .replace(/<(script|style|nav|footer|aside|header|noscript|iframe|figure)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|h[1-6]|li|blockquote|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .split('\n').map(l => l.trim()).filter(l => l.length > 20).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 10000)
    .trim();
}

function fetchUrl(url, depth = 0) {
  return new Promise(resolve => {
    if (depth > 3) return resolve({ url, error: 'too many redirects', text: '' });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      resolve({ url, error: 'timeout', text: '' });
    }, TIMEOUT_MS);

    const proto = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      },
    };

    try {
      const req = proto.get(url, options, res => {
        if (timedOut) return;
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
          resolve({ url, text: extractText(Buffer.concat(chunks).toString('utf8')), error: null });
        });
        res.on('error', e => { clearTimeout(timer); resolve({ url, error: e.message, text: '' }); });
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

async function main() {
  const items = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  if (!Array.isArray(items)) {
    console.error('parallel: expected a JSON array in ' + inputFile);
    process.exit(1);
  }
  console.error(`parallel: ${items.length} urls, concurrency=${concurrency}`);
  const t0 = Date.now();

  for (let i = 0; i < items.length; i += concurrency) {
    const batch    = items.slice(i, i + concurrency);
    const batchRes = await Promise.all(batch.map(it => fetchUrl(it.url || it.best_url || it.link)));
    batchRes.forEach((r, j) => {
      const target = items[i + j];
      target.body_text = r.text || '';
      if (r.error) target.body_fetch_error = r.error;
    });
    const ok = batchRes.filter(r => r.text && r.text.length > 200).length;
    console.error(`  batch ${Math.floor(i / concurrency) + 1} (${batch.length}): ${ok} bodies ≥200 chars, ${batch.length - ok} thin/failed`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const ok      = items.filter(x => (x.body_text || '').length > 200).length;
  const avgLen  = ok ? Math.round(items.reduce((s, x) => s + (x.body_text || '').length, 0) / ok) : 0;
  fs.writeFileSync(outFile, JSON.stringify(items, null, 2));
  console.error(`parallel: ${ok}/${items.length} bodies in ${elapsed}s (avg ${avgLen} chars) → ${outFile}`);
}

main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
