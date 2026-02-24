#!/usr/bin/env node
/**
 * AI Daily - HTML Generator
 * 把 news.json 渲染成炫酷的 HTML 看板
 */

const fs = require('fs');
const path = require('path');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const OUTPUT_DIR = path.join(__dirname, 'docs');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

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
  const files = getArchiveFiles(outputDir, currentDate);
  if (files.length <= 1) return '';
  const items = files.map(f => {
    const date = f.replace('.html', '');
    const isToday = date === currentDate;
    return `<a href="./${f}" class="archive-item ${isToday ? 'archive-today' : ''}">${date}${isToday ? ' <span class="today-tag">今日</span>' : ''}</a>`;
  }).join('\n');
  return `
  <div class="archive-nav">
    <span class="archive-nav-label">📅 历史归档</span>
    <div class="archive-nav-items">${items}</div>
  </div>`;
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
  const archiveNav = renderArchiveNav(OUTPUT_DIR, fileDate);

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
    heat:         a.heat         || 3,
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

  // Save as dated file + latest
  const outFile = path.join(OUTPUT_DIR, `${fileDate}.html`);
  const latestFile = path.join(OUTPUT_DIR, 'index.html');

  fs.writeFileSync(outFile, html);
  fs.writeFileSync(latestFile, html);

  console.log(`✅ Generated: ${outFile}`);
  return { outFile, latestFile, date: fileDate };
}

// CLI usage: node generate.js news.json [--push] [--date YYYY-MM-DD]
if (require.main === module) {
  const { execSync } = require('child_process');
  const inputFile = process.argv[2] || path.join(__dirname, 'latest-news.json');
  const shouldPush = process.argv.includes('--push');

  // Optional --date override (e.g. --date 2026-02-23)
  const dateArgIdx = process.argv.indexOf('--date');
  if (dateArgIdx !== -1 && process.argv[dateArgIdx + 1]) {
    process.env._GENERATE_DATE_OVERRIDE = process.argv[dateArgIdx + 1];
  }

  if (!fs.existsSync(inputFile)) {
    console.error('❌ News JSON not found:', inputFile);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
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
