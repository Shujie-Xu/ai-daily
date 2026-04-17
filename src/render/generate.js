#!/usr/bin/env node
/**
 * AI Daily - HTML Generator
 * 把 news.json 渲染成炫酷的 HTML 看板
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const TEMPLATE = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const OG_TEMPLATE_PATH = path.join(__dirname, 'og-template.html');
const OUTPUT_DIR = path.join(ROOT, 'docs');
const AUDIO_DIR  = path.join(OUTPUT_DIR, 'audio');
const OG_DIR = path.join(OUTPUT_DIR, 'og');
const TTS_SCRIPT = path.join(__dirname, 'tts_gen.py');
const DEFAULT_OG_IMAGE_URL = 'https://shujie-xu.github.io/ai-daily/og.png';

if (!fs.existsSync(OG_DIR))     fs.mkdirSync(OG_DIR, { recursive: true });

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(AUDIO_DIR))  fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ── 根据标题生成稳定的短 hash（不依赖索引）──────────────────
function titleHash(title) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(title || '').digest('hex').slice(0, 8);
}

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateOgTitle(text = '', maxChars = 28) {
  const chars = Array.from(String(text || '').trim().replace(/\s+/g, ' '));
  if (chars.length <= maxChars) return chars.join('');
  return chars.slice(0, Math.max(0, maxChars - 1)).join('') + '…';
}

function formatOgDateDisplay(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

function generateOgImage(articles, dateStr) {
  const { execFileSync } = require('child_process');
  const outputPath = path.join(OG_DIR, `${dateStr}.jpg`);
  const ogImageUrl = `https://shujie-xu.github.io/ai-daily/og/${dateStr}.jpg`;

  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    return { ok: true, outputPath, ogImageUrl, skipped: true };
  }

  try {
    const ogTemplate = fs.readFileSync(OG_TEMPLATE_PATH, 'utf8');
    const topTitles = articles.slice(0, 3).map(a => truncateOgTitle(a.title || ''));
    while (topTitles.length < 3) topTitles.push('今日 AI 动态整理中');

    const html = ogTemplate
      .replace(/{{DATE_DISPLAY}}/g, escapeHtml(formatOgDateDisplay(dateStr)))
      .replace(/{{TOTAL}}/g, escapeHtml(String(articles.length || 0)))
      .replace(/{{T1}}/g, escapeHtml(topTitles[0]))
      .replace(/{{T2}}/g, escapeHtml(topTitles[1]))
      .replace(/{{T3}}/g, escapeHtml(topTitles[2]));

    const tempHtmlPath = `/tmp/og-render-${dateStr}.html`;
    fs.writeFileSync(tempHtmlPath, html, 'utf8');

    execFileSync('chromium', [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--hide-scrollbars',
      '--virtual-time-budget=3000',
      '--window-size=1200,630',
      `--screenshot=${outputPath}`,
      `file://${tempHtmlPath}`,
    ], { timeout: 30000, stdio: 'pipe' });

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error('Chromium screenshot output missing or empty');
    }

    return { ok: true, outputPath, ogImageUrl, skipped: false };
  } catch (error) {
    console.warn(`⚠️ OG 图生成失败：${error.message}`);
    return { ok: false, outputPath: null, ogImageUrl: DEFAULT_OG_IMAGE_URL, error: error.message };
  }
}

// ── TTS: 为文章生成音频 ──────────────────────────────────────
function generateAudio(articles, date, forceTts = false) {
  const { spawnSync } = require('child_process');
  const results = [];

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const hash = titleHash(a.title);
    const filename = `${date}-${hash}.mp3`;
    const outPath  = path.join(AUDIO_DIR, filename);

    // 已存在就跳过（除非传入 forceTts=true）
    if (!forceTts && fs.existsSync(outPath)) {
      results.push(`audio/${filename}`);
      continue;
    }
    // force 时先删旧文件
    if (forceTts && fs.existsSync(outPath)) fs.unlinkSync(outPath);

    // 拼接朗读文本：标题 + 正文（去除 HTML 标签和 markdown 标记）
    const rawContent = (a.full_content || a.summary || '').replace(/<[^>]+>/g, '').replace(/\*\*/g, '');
    const ttsText = `${a.title}。${rawContent}`.slice(0, 2000); // 最多 2000 字

    try {
      const r = spawnSync('python3', [TTS_SCRIPT, outPath], {
        input: ttsText,
        encoding: 'utf8',
        timeout: 30000, // 每篇最多等 30 秒
      });
      if (r.status === 0 && fs.existsSync(outPath)) {
        results.push(`audio/${filename}`);
        process.stderr.write(r.stderr || '');
      } else {
        console.warn(`  ⚠️ TTS 失败 [${i}]: ${r.stderr || r.error?.message || 'unknown'}`);
        results.push(null); // 无音频 → 前端回退 Web Speech
      }
    } catch (e) {
      console.warn(`  ⚠️ TTS 异常 [${i}]: ${e.message}`);
      results.push(null);
    }
  }
  return results; // 与 articles 等长，无音频时为 null
}

// ── 清理 90 天以上的音频文件 ────────────────────────────────
function cleanupOldAudio(days = 90) {
  if (!fs.existsSync(AUDIO_DIR)) return;
  const cutoff = Date.now() - days * 86400 * 1000;
  const files = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));
  let removed = 0;
  for (const f of files) {
    // 文件名格式 YYYY-MM-DD-HASH.mp3 或旧格式 YYYY-MM-DD-N.mp3
    const m = f.match(/^(\d{4}-\d{2}-\d{2})-.+\.mp3$/);
    if (m) {
      const fileDate = new Date(m[1]).getTime();
      if (fileDate < cutoff) {
        fs.unlinkSync(path.join(AUDIO_DIR, f));
        removed++;
      }
    }
  }
  if (removed > 0) console.log(`🗑️  清理了 ${removed} 个过期音频（>${days}天）`);
}

function heatToStars(score) {
  if (score >= 5) return '🔥🔥🔥🔥🔥';
  if (score >= 4) return '🔥🔥🔥🔥';
  if (score >= 3) return '🔥🔥🔥';
  if (score >= 2) return '🔥🔥';
  return '🔥';
}

function heatLabel(score) {
  if (score >= 5) return '顶级热点';
  if (score >= 4) return '高热度';
  if (score >= 3) return '中等热度';
  return '值得关注';
}

function getBadgeClass(cat) {
  const map = {
    'model':    'badge-model',
    'product':  'badge-product',
    'funding':  'badge-funding',
    'finance':  'badge-finance',
    'research': 'badge-research',
    'policy':   'badge-policy',
    'event':    'badge-event',
  };
  return map[cat] || 'badge-product';
}

function getCatLabel(cat) {
  const map = {
    'model':    '🧠 模型',
    'product':  '📦 产品',
    'funding':  '💰 融资',
    'finance':  '📊 财务',
    'research': '🔬 研究',
    'policy':   '📜 政策',
    'event':    '🎪 事件',
  };
  return map[cat] || cat;
}

function renderCard(item, featured = false, globalIdx = 0) {
  const cats = (item.categories || ['product']).map(c =>
    `<span class="badge ${getBadgeClass(c)}">${getCatLabel(c)}</span>`
  ).join('');

  const tags = (item.tags || []);
  const tagsHtml = tags.length > 0
    ? `<div class="card-tags">${tags.map(t => `<span class="tag-pill">#${t}</span>`).join('')}</div>`
    : '';

  const featureAccent = featured ? '<div class="featured-accent"></div>' : '';
  const cardClass = featured ? 'news-card featured' : 'news-card';

  const domain = (() => {
    try { return new URL(item.url).hostname.replace('www.', ''); } catch { return ''; }
  })();

  return `
    <div class="${cardClass}" data-idx="${globalIdx}" data-cats="${(item.categories||['product']).join(' ')}"
         onclick="openDetail(${globalIdx})" role="button" tabindex="0"
         onkeydown="if(event.key==='Enter'||event.key===' ')openDetail(${globalIdx})">
      ${featureAccent}
      <div style="flex:1; display:flex; flex-direction:column; gap:12px;">
        <div class="card-top">
          <div class="card-cats">${cats}</div>
        </div>
        <div class="card-title">${item.title}</div>
        ${tagsHtml}
        <div class="card-summary">${item.summary}</div>
        <div class="card-footer">
          <span class="card-source">${domain}</span>
          <span class="card-cta">查看详情 →</span>
        </div>
      </div>
    </div>`;
}

// Returns { html, sortedArticles } — sortedArticles is in display order (by heat desc)
function renderSections(articles) {
  // New template is fully client-rendered; sections HTML is empty
  const sorted = [...articles].sort((a, b) => (b.heat || 3) - (a.heat || 3));
  return { html: '', sortedArticles: sorted };

  // ── legacy code below (kept for reference, never reached) ──
  const groups = [
    { min: 5, label: '🔥🔥🔥🔥🔥 顶级热点' },
    { min: 4, label: '🔥🔥🔥🔥 高热度' },
    { min: 3, label: '🔥🔥🔥 中等热度' },
    { min: 0, label: '🔥🔥 值得关注' },
  ];
  const idxMap = new Map(sorted.map((a, i) => [a, i]));

  let html = '';

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const prevMin = groups[i - 1]?.min ?? 99;
    const items = sorted.filter(a => (a.heat || 3) >= g.min && (a.heat || 3) < prevMin);
    if (items.length === 0) continue;

    const cards = items.map((item, localIdx) =>
      renderCard(item, i === 0 && localIdx === 0, idxMap.get(item))
    ).join('\n');

    html += `
    <div class="news-section">
      <div class="section-header">
        <span class="heat-label">${g.label.split(' ')[0]}</span>
        <span class="section-title">${g.label.split(' ').slice(1).join(' ')}</span>
        <div class="section-line"></div>
      </div>
      <div class="news-grid">
        ${cards}
      </div>
    </div>`;
  }

  return { html, sortedArticles: sorted };
}

function renderFilterBar(articles) {
  // New template renders filter bar client-side; return empty string
  return '';
}

function getArchiveFiles(outputDir, currentDate) {
  return fs.readdirSync(outputDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
    .sort()
    .reverse();
}

function renderArchiveNav(outputDir, currentDate) {
  // Archive is fully client-side via archive.js — always render the container
  // (data comes from data/manifest.json, not HTML files)
  return `\n  <div id="archiveSection" class="archive-cal-section"></div>`;
}

function writeArchiveJs(outputDir) {
  // Read from manifest.json (new JSON-based archive), falling back to old HTML files
  const manifestPath = path.join(outputDir, 'data', 'manifest.json');
  let dates;
  if (fs.existsSync(manifestPath)) {
    dates = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).map(e => e.date);
  } else {
    dates = getArchiveFiles(outputDir, null).map(f => f.replace('.html', ''));
  }
  const content = `// Auto-generated by generate.js — do not edit manually\nwindow.ARCHIVE_DATES = ${JSON.stringify(dates)};\n`;
  fs.writeFileSync(path.join(outputDir, 'archive.js'), content);
}

function renderArchive(outputDir, currentDate) {
  return ''; // 归档已移至顶部导航，底部不再重复
}

function generate(newsData) {
  const now = new Date();

  // ── 日报日期（标题 / 文件名 / 归档依据）──────────────────────
  // 优先级：--date CLI > newsData.date 字段 > 今天系统日期
  const dateOverride = process.env._GENERATE_DATE_OVERRIDE;
  let fileDate;
  if (dateOverride && /^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) {
    fileDate = dateOverride;
  } else if (newsData.date && /^\d{4}-\d{2}-\d{2}$/.test(newsData.date)) {
    fileDate = newsData.date;   // 从 JSON 的 date 字段读取日报日期
  } else {
    fileDate = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');
  }
  const [fy, fm, fd] = fileDate.split('-');
  const dateStr = `${fy}/${fm}/${fd}`;   // 页面显示格式：2026/02/23

  // ── 最后编辑时间（格式：edit: yy/mm/dd hh:mm CST）────────────
  const _fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: '2-digit', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const _parts = Object.fromEntries(_fmt.formatToParts(now).map(p => [p.type, p.value]));
  const editTime    = `${_parts.year}/${_parts.month}/${_parts.day} ${_parts.hour}:${_parts.minute} CST`;
  const datetimeStr = editTime;  // kept for legacy {{DATETIME}} uses

  const articles = newsData.articles || [];
  const sources = [...new Set(articles.map(a => {
    try { return new URL(a.url).hostname; } catch { return ''; }
  }).filter(Boolean))].length;

  const archiveHtml = renderArchive(OUTPUT_DIR, fileDate);
  const archiveNav  = renderArchiveNav(OUTPUT_DIR, fileDate);
  const ogResult = generateOgImage(articles, fileDate);

  // OG description: top 3 headlines
  const top3 = articles.slice(0, 3).map(a => a.title).join(' · ');
  const ogDesc = `今日 ${articles.length} 条 · 来自 ${sources || newsData.sourceCount || '?'} 个信息源 · ${top3}`;

  // Render filter bar with per-category counts
  const filterBarHtml = renderFilterBar(articles);

  // Render sections (returns html + sortedArticles in display order)
  const { html: sectionsHtml, sortedArticles } = renderSections(articles);

  // Serialize article data for the detail overlay JS
  // Only include fields needed by the detail view (omit heavy fields not needed for card rendering)
  const articlesJson = JSON.stringify(sortedArticles.map(a => ({
    title:        a.title        || '',
    summary:      a.summary      || '',
    full_content: a.full_content || '',
    url:          a.url          || '',
    best_url:     a.best_url     || a.url || '',
    categories:   a.categories   || ['product'],
    tags:         a.tags         || [],
    context:      a.context      || '',
    heat:         a.heat         || 3,
    audio_url:    a.audio_url    || null,
  })));

  const html = TEMPLATE
    .replace(/{{DATE}}/g, dateStr)
    .replace(/{{EDIT_TIME}}/g, editTime)
    .replace(/{{DATETIME}}/g, datetimeStr)
    .replace(/{{TOTAL}}/g, articles.length)
    .replace(/{{SOURCES}}/g, sources || newsData.sourceCount || '?')
    .replace(/{{SEARCH_COUNT}}/g, newsData.searchCount || '?')
    .replace(/{{DIMENSIONS}}/g, newsData.dimensions || '模型/产品/融资/财务/研究/政策/事件')
    .replace(/{{OG_DESC}}/g, ogDesc)
    .replace(/{{OG_IMAGE_URL}}/g, ogResult.ogImageUrl)
    .replace(/{{ARCHIVE_NAV}}/g, archiveNav)
    .replace(/{{ARTICLES_JSON}}/g, articlesJson)
    .replace(/{{FILTER_BAR}}/g, filterBarHtml)
    .replace(/{{SECTIONS}}/g, sectionsHtml + archiveHtml);

  // ── 写 data/YYYY-MM-DD.json（存 JSON，不存 HTML 存档）─────────
  const dataDir = path.join(OUTPUT_DIR, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // 将带 audio_url 的文章数据写入 data/{date}.json
  const dataPayload = {
    date:        fileDate,
    editTime:    editTime,
    total:       articles.length,
    sources:     sources || newsData.sourceCount || 0,
    searchCount: newsData.searchCount || 0,
    dimensions:  newsData.dimensions || '',
    articles:    sortedArticles.map(a => ({
      title:        a.title        || '',
      summary:      a.summary      || '',
      full_content: a.full_content || '',
      url:          a.url          || '',
      best_url:     a.best_url     || a.url || '',
      categories:   a.categories   || ['product'],
      tags:         a.tags         || [],
      context:      a.context      || '',
      heat:         a.heat         || 3,
      audio_url:    a.audio_url    || null,
    }))
  };
  fs.writeFileSync(path.join(dataDir, `${fileDate}.json`), JSON.stringify(dataPayload));

  // ── 更新 data/manifest.json（前端日期选择器用）────────────────
  const manifestPath = path.join(dataDir, 'manifest.json');
  let manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : [];
  // 去重并更新当天条目
  manifest = manifest.filter(e => e.date !== fileDate);
  manifest.push({ date: fileDate, total: articles.length });
  manifest.sort((a, b) => b.date.localeCompare(a.date)); // 最新在前
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  // ── 写 index.html（唯一的 HTML，动态加载数据）──────────────────
  const latestFile = path.join(OUTPUT_DIR, 'index.html');
  fs.writeFileSync(latestFile, html);

  // ── 保持 archive.js 兼容旧逻辑（从 manifest 生成）─────────────
  const archiveDates = manifest.map(e => e.date);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'archive.js'),
    `// Auto-generated\nwindow.ARCHIVE_DATES = ${JSON.stringify(archiveDates)};\n`
  );

  console.log(`✅ Generated: docs/data/${fileDate}.json + index.html`);
  if (ogResult.ok) {
    console.log(`🖼️  OG image ${ogResult.skipped ? 'reused' : 'generated'}: ${path.relative(__dirname, ogResult.outputPath)}`);
  } else {
    console.log(`🖼️  OG image fallback: ${ogResult.ogImageUrl}`);
  }
  return { latestFile, date: fileDate, og: ogResult };
}

// CLI usage: node generate.js [news.json] [--push] [--date YYYY-MM-DD] [--no-tts] [--force-tts]
// Default input: tmp/merged.json (output of src/pipeline/merge.js)
if (require.main === module) {
  const { execSync } = require('child_process');
  const arg2 = process.argv[2];
  const inputFile = (arg2 && !arg2.startsWith('--')) ? arg2 : path.join(ROOT, 'tmp', 'merged.json');
  const shouldPush  = process.argv.includes('--push');
  const skipTts     = process.argv.includes('--no-tts');
  const forceTts    = process.argv.includes('--force-tts');

  // Optional --date override
  const dateArgIdx = process.argv.indexOf('--date');
  if (dateArgIdx !== -1 && process.argv[dateArgIdx + 1]) {
    process.env._GENERATE_DATE_OVERRIDE = process.argv[dateArgIdx + 1];
  }

  if (!fs.existsSync(inputFile)) {
    console.error('❌ News JSON not found:', inputFile);
    process.exit(1);
  }
  let data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  if (Array.isArray(data)) { data = { articles: data }; }

  // 确定日期（与 generate() 内部逻辑保持一致）
  const fileDate = process.env._GENERATE_DATE_OVERRIDE || data.date ||
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

  // ── 清理 30 天以上的旧音频 ──
  cleanupOldAudio(90);

  // ── 生成 TTS 音频 ──
  if (!skipTts) {
    console.log(`🎙️  生成音频（${data.articles.length} 篇）...`);
    const audioPaths = generateAudio(data.articles, fileDate, forceTts);
    // 把 audio_url 注入到文章数据里供模板使用
    data.articles = data.articles.map((a, i) =>
      audioPaths[i] ? { ...a, audio_url: audioPaths[i] } : a
    );
    const ok = audioPaths.filter(Boolean).length;
    console.log(`  ✅ 音频生成完成：${ok}/${data.articles.length} 篇`);
  } else {
    // --no-tts：优先从 data/YYYY-MM-DD.json 继承（按标题匹配，避免排序错位）
    const existingPath = path.join(OUTPUT_DIR, 'data', `${fileDate}.json`);
    if (fs.existsSync(existingPath)) {
      const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
      // 按标题匹配 audio_url，不按 index（两者排序可能不同）
      const urlMap = new Map(existing.articles.map(a => [a.title, a.audio_url]));
      data.articles = data.articles.map(a => ({
        ...a, audio_url: a.audio_url || urlMap.get(a.title) || null
      }));
    }
    // 如果 JSON 里仍然没有，尝试从 audio/ 目录按 hash 命名规则找
    const audioDir = path.join(OUTPUT_DIR, 'audio');
    data.articles = data.articles.map((a) => {
      if (a.audio_url) return a;
      const hash = titleHash(a.title);
      const mp3 = path.join(audioDir, `${fileDate}-${hash}.mp3`);
      return fs.existsSync(mp3) ? { ...a, audio_url: `audio/${fileDate}-${hash}.mp3` } : a;
    });
    const preserved = data.articles.filter(a => a.audio_url).length;
    if (preserved > 0) console.log(`  🔇 --no-tts：保留已有音频 ${preserved} 篇`);
  }

  const result = generate(data);
  console.log('🌐 Output:', result.latestFile);

  if (shouldPush) {
    pushDocsToGhPages(OUTPUT_DIR, result.date);
  }
}

// Publish docs/ to the gh-pages branch via a temporary git worktree.
// Keeps main free of generated artifacts; gh-pages holds only the site.
function pushDocsToGhPages(docsDir, date) {
  const { execSync } = require('child_process');
  const os = require('os');
  const wt = path.join(os.tmpdir(), `ai-daily-pages-${Date.now()}`);
  const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
  try {
    sh(`git -C "${ROOT}" fetch origin gh-pages`);
    sh(`git -C "${ROOT}" worktree add -B gh-pages "${wt}" origin/gh-pages`);
    fs.cpSync(docsDir, path.join(wt, 'docs'), { recursive: true });
    sh(`git -C "${wt}" add docs/`);
    const dirty = execSync(`git -C "${wt}" status --porcelain`).toString().trim();
    if (!dirty) {
      console.log('🟰 docs/ 无变化，跳过推送');
      return;
    }
    sh(`git -C "${wt}" commit -m "📰 AI日报更新 ${date}"`);
    sh(`git -C "${wt}" push origin gh-pages`);
    console.log('🚀 已推送到 gh-pages');
  } catch (e) {
    console.error('⚠️ 推送 gh-pages 失败:', e.message);
  } finally {
    try { execSync(`git -C "${ROOT}" worktree remove --force "${wt}"`); } catch {}
  }
}

module.exports = { generate };
