#!/usr/bin/env node
/**
 * AI Daily - HTML Generator
 * 把 news.json 渲染成炫酷的 HTML 看板
 */

const fs = require('fs');
const path = require('path');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const OUTPUT_DIR = path.join(__dirname, 'docs');
const AUDIO_DIR  = path.join(OUTPUT_DIR, 'audio');
const TTS_SCRIPT = path.join(__dirname, 'tts_gen.py');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(AUDIO_DIR))  fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ── TTS: 为文章生成音频 ──────────────────────────────────────
function generateAudio(articles, date) {
  const { spawnSync } = require('child_process');
  const results = [];

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const filename = `${date}-${i}.mp3`;
    const outPath  = path.join(AUDIO_DIR, filename);

    // 已存在就跳过
    if (fs.existsSync(outPath)) {
      results.push(`audio/${filename}`);
      continue;
    }

    // 拼接朗读文本：标题 + 正文（去除 HTML 标签）
    const rawContent = (a.full_content || a.summary || '').replace(/<[^>]+>/g, '');
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
    // 文件名格式 YYYY-MM-DD-N.mp3，从名称解析日期
    const m = f.match(/^(\d{4}-\d{2}-\d{2})-\d+\.mp3$/);
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
  const groups = [
    { min: 5, label: '🔥🔥🔥🔥🔥 顶级热点' },
    { min: 4, label: '🔥🔥🔥🔥 高热度' },
    { min: 3, label: '🔥🔥🔥 中等热度' },
    { min: 0, label: '🔥🔥 值得关注' },
  ];

  // Sort once — this is the canonical display order; indices used in openDetail()
  const sorted = [...articles].sort((a, b) => (b.heat || 3) - (a.heat || 3));
  // Map each article object → its position in the sorted array
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
  const CAT_ORDER = ['model', 'product', 'funding', 'finance', 'research', 'policy', 'event'];
  const CAT_LABELS = {
    model: '🧠 模型', product: '📦 产品', funding: '💰 融资',
    finance: '📊 财务', research: '🔬 研究', policy: '📜 政策', event: '🎪 事件',
  };

  // count articles per category (an article in multiple cats counts in each)
  const counts = {};
  articles.forEach(a => {
    (a.categories || ['product']).forEach(c => {
      counts[c] = (counts[c] || 0) + 1;
    });
  });

  const total = articles.length;
  const buttons = CAT_ORDER
    .filter(c => counts[c])   // hide empty categories
    .map(c => `<button class="filter-tag" data-cat="${c}" onclick="setFilter('${c}')">${CAT_LABELS[c]}<span class="filter-count">${counts[c]}</span></button>`)
    .join('\n    ');

  return `<div class="filter-bar" id="filterBar">
    <button class="filter-tag active" data-cat="all" onclick="setFilter('all')">全部<span class="filter-count">${total}</span></button>
    ${buttons}
  </div>`;
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
  return { latestFile, date: fileDate };
}

// CLI usage: node generate.js news.json [--push] [--date YYYY-MM-DD] [--no-tts]
if (require.main === module) {
  const { execSync } = require('child_process');
  const inputFile = process.argv[2] || path.join(__dirname, 'latest-news.json');
  const shouldPush  = process.argv.includes('--push');
  const skipTts     = process.argv.includes('--no-tts');

  // Optional --date override
  const dateArgIdx = process.argv.indexOf('--date');
  if (dateArgIdx !== -1 && process.argv[dateArgIdx + 1]) {
    process.env._GENERATE_DATE_OVERRIDE = process.argv[dateArgIdx + 1];
  }

  if (!fs.existsSync(inputFile)) {
    console.error('❌ News JSON not found:', inputFile);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

  // 确定日期（与 generate() 内部逻辑保持一致）
  const fileDate = process.env._GENERATE_DATE_OVERRIDE || data.date ||
    new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });

  // ── 清理 30 天以上的旧音频 ──
  cleanupOldAudio(30);

  // ── 生成 TTS 音频 ──
  if (!skipTts) {
    console.log(`🎙️  生成音频（${data.articles.length} 篇）...`);
    const audioPaths = generateAudio(data.articles, fileDate);
    // 把 audio_url 注入到文章数据里供模板使用
    data.articles = data.articles.map((a, i) =>
      audioPaths[i] ? { ...a, audio_url: audioPaths[i] } : a
    );
    const ok = audioPaths.filter(Boolean).length;
    console.log(`  ✅ 音频生成完成：${ok}/${data.articles.length} 篇`);
  }

  const result = generate(data);
  console.log('🌐 Output:', result.latestFile);

  if (shouldPush) {
    try {
      execSync(`cd ${__dirname} && git add docs/ && git commit -m "📰 AI日报更新 ${result.date}" && git push`, { stdio: 'inherit' });
      console.log('🚀 已推送到 GitHub Pages！');
    } catch (e) {
      console.error('⚠️ git push 失败:', e.message);
    }
  }
}

module.exports = { generate };
