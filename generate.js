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
    'funding': 'badge-funding',
    'model': 'badge-model',
    'product': 'badge-product',
    'research': 'badge-research',
    'policy': 'badge-policy',
    'open-source': 'badge-open-source',
  };
  return map[cat] || 'badge-product';
}

function getCatLabel(cat) {
  const map = {
    'funding': '💰 融资',
    'model': '🧠 模型',
    'product': '📦 产品',
    'research': '🔬 研究',
    'policy': '📜 政策',
    'open-source': '💻 开源',
  };
  return map[cat] || cat;
}

function renderCard(item, featured = false, globalIdx = 0) {
  const cats = (item.categories || ['product']).map(c =>
    `<span class="badge ${getBadgeClass(c)}">${getCatLabel(c)}</span>`
  ).join('');

  const featureAccent = featured ? '<div class="featured-accent"></div>' : '';
  const cardClass = featured ? 'news-card featured' : 'news-card';

  const domain = (() => {
    try { return new URL(item.url).hostname.replace('www.', ''); } catch { return ''; }
  })();

  return `
    <div class="${cardClass}" onclick="openDetail(${globalIdx})" role="button" tabindex="0"
         onkeydown="if(event.key==='Enter'||event.key===' ')openDetail(${globalIdx})">
      ${featureAccent}
      <div style="flex:1; display:flex; flex-direction:column; gap:12px;">
        <div class="card-top">
          <div class="card-cats">${cats}</div>
          <div class="heat-score" title="${heatLabel(item.heat)}">${heatToStars(item.heat)}</div>
        </div>
        <div class="card-title">${item.title}</div>
        <div class="card-summary">${item.summary}</div>
        <div class="card-footer">
          <span class="card-source">${domain}</span>
          <span class="card-link" style="pointer-events:none">查看详情 →</span>
        </div>
      </div>
    </div>`;
}

// Returns { html, sortedArticles } — sortedArticles is in display order (by heat desc)
function renderSections(articles) {
  const groups = [
    { min: 5, label: '⭐⭐⭐⭐⭐ 顶级热点' },
    { min: 4, label: '⭐⭐⭐⭐ 高热度' },
    { min: 3, label: '⭐⭐⭐ 中等热度' },
    { min: 0, label: '⭐⭐ 值得关注' },
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

function renderArchive(outputDir, currentDate) {
  const files = fs.readdirSync(outputDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
    .sort()
    .reverse();

  if (files.length <= 1) return '';

  const items = files.map(f => {
    const date = f.replace('.html', '');
    const isToday = date === currentDate;
    return `<a href="./${f}" class="archive-item ${isToday ? 'archive-today' : ''}">${date}${isToday ? ' <span class="today-tag">今天</span>' : ''}</a>`;
  }).join('\n');

  return `
  <div class="archive-section">
    <div class="section-header" style="margin-bottom:16px">
      <span class="heat-label">📅</span>
      <span class="section-title">历史归档</span>
      <div class="section-line"></div>
    </div>
    <div class="archive-list">${items}</div>
  </div>`;
}

function generate(newsData) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' });
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
  const datetimeStr = `${dateStr} ${timeStr}`;
  const fileDate = dateStr.replace(/\//g, '-');

  const articles = newsData.articles || [];
  const fundingCount = articles.filter(a => (a.categories || []).includes('funding')).length;
  const modelCount = articles.filter(a => (a.categories || []).includes('model')).length;
  const sources = [...new Set(articles.map(a => {
    try { return new URL(a.url).hostname; } catch { return ''; }
  }).filter(Boolean))].length;

  const archiveHtml = renderArchive(OUTPUT_DIR, fileDate);

  // OG description: top 3 headlines
  const top3 = articles.slice(0, 3).map(a => a.title).join(' · ');
  const ogDesc = `今日 ${articles.length} 条 | 💰融资 ${fundingCount} 条 | 🧠模型 ${modelCount} 条 · ${top3}`;

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
    heat:         a.heat         || 3,
  })));

  const html = TEMPLATE
    .replace(/{{DATE}}/g, dateStr)
    .replace(/{{TIME}}/g, timeStr)
    .replace(/{{DATETIME}}/g, datetimeStr)
    .replace(/{{TOTAL}}/g, articles.length)
    .replace(/{{FUNDING_COUNT}}/g, fundingCount)
    .replace(/{{MODEL_COUNT}}/g, modelCount)
    .replace(/{{SOURCES}}/g, sources || newsData.sourceCount || '?')
    .replace(/{{SEARCH_COUNT}}/g, newsData.searchCount || '?')
    .replace(/{{DIMENSIONS}}/g, newsData.dimensions || 'A/B/C/D/E/F')
    .replace(/{{OG_DESC}}/g, ogDesc)
    .replace(/{{ARTICLES_JSON}}/g, articlesJson)
    .replace(/{{SECTIONS}}/g, sectionsHtml + archiveHtml);

  // Save as dated file + latest
  const outFile = path.join(OUTPUT_DIR, `${fileDate}.html`);
  const latestFile = path.join(OUTPUT_DIR, 'index.html');

  fs.writeFileSync(outFile, html);
  fs.writeFileSync(latestFile, html);

  console.log(`✅ Generated: ${outFile}`);
  return { outFile, latestFile, date: fileDate };
}

// CLI usage: node generate.js news.json [--push]
if (require.main === module) {
  const { execSync } = require('child_process');
  const inputFile = process.argv[2] || path.join(__dirname, 'latest-news.json');
  const shouldPush = process.argv.includes('--push');

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
