#!/usr/bin/env node
/**
 * merge.js — Merge fetch results, dedupe by URL, filter by quality + recency
 *
 * Usage:
 *   node src/pipeline/merge.js <file1.json> [file2.json ...] [flags]
 *
 * Flags (all optional):
 *   --days=1            recency cutoff in days
 *   --min-score=0.5     drop Tavily items with score < this
 *   --max-per-host=3    cap how many items per hostname
 *   --limit=N           hard cap on output (0 = no cap)
 *   --out=PATH          output file (default tmp/merged.json)
 *
 * Pipeline: load → dedup URL (within run + cross-run) → score filter → require date
 *           → recency filter → host cap → sort → optional hard cap → write + persist seen-urls
 *
 * No date = no trust. Items without a published date are dropped — undated pages
 * are typically digests or evergreen SEO that can resurface old events as new.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT  = path.resolve(__dirname, '../..');
const args  = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const argVal = (flag, dflt) => {
  const a = args.find(x => x.startsWith(`${flag}=`));
  return a ? a.split('=')[1] : dflt;
};
const days       = parseInt(argVal('--days', '1'), 10);
const minScore   = parseFloat(argVal('--min-score', '0.5'));
const maxPerHost = parseInt(argVal('--max-per-host', '3'), 10);
const limit      = parseInt(argVal('--limit', '0'), 10);
const outFile    = argVal('--out', path.join(ROOT, 'tmp', 'merged.json'));

if (files.length === 0) {
  console.error('usage: merge.js <file1.json> [file2.json ...] [--days=1] [--min-score=0.5] [--max-per-host=3] [--limit=N] [--out=...]');
  process.exit(1);
}

const seenUrlsFile = path.join(ROOT, 'state', 'seen-urls.json');
let seenUrls = new Set();
try { seenUrls = new Set(JSON.parse(fs.readFileSync(seenUrlsFile, 'utf8'))); } catch {}

const cutoff = new Date(Date.now() - days * 86_400_000);
const stats  = { in: 0, dupUrl: 0, lowScore: 0, nonAi: 0, tooOld: 0, undated: 0, hostCapped: 0 };

const AI_INCLUDE_RE = /(\b(ai|agi|llm|gpt|gemini|claude|grok|copilot|agent|agents|robot|robotics|humanoid|autonomous\s*driving|self-?driving|vla|world\s*model|diffusion|inference|training|fine-?tuning|foundation\s*model|chip|chips|gpu|hbm|asic|semiconductor|data\s*center|cloud|developer\s*tool|coding\s*assistant|openai|anthropic|deepmind|hugging\s*face|mistral|xai|tesla|nvidia|tsmc)\b|人工智能|AI|智能体|大模型|模型|机器人|具身智能|自动驾驶|芯片|算力|推理|训练|数据中心|云计算|编程工具|开发者工具|半导体)/i;

function isAiRelevant(item) {
  const text = [item.title, item.summary, item.source, item.url].filter(Boolean).join(' ');
  return AI_INCLUDE_RE.test(text);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of ['utm_source','utm_medium','utm_campaign','utm_term','utm_content']) u.searchParams.delete(k);
    return u.toString().replace(/\/$/, '');
  } catch { return url; }
}
function hostnameOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }

// Load all items
let allItems = [];
for (const f of files) {
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    allItems.push(...(Array.isArray(data) ? data : (data.articles || data.results || [])));
  } catch (e) {
    console.warn(`merge: skipping ${f}: ${e.message}`);
  }
}
stats.in = allItems.length;

// Filter: dedup → score → recency
const seen = new Set();
let kept = [];
for (const item of allItems) {
  const url = normalizeUrl(item.url || item.link || '');
  if (!url || seen.has(url) || seenUrls.has(url)) { stats.dupUrl++; continue; }

  // Tavily score filter (RSS items have no score → keep them)
  const score = typeof item.score === 'number' ? item.score : null;
  if (score !== null && score < minScore) { stats.lowScore++; continue; }

  // One-line topical filter: keep only clearly AI / tech-relevant items.
  if (!isAiRelevant(item)) { stats.nonAi++; continue; }

  // Date is required — no date means we can't trust freshness (typically digests / SEO pages)
  const pubStr = item.published || item.pubDate || item.date || null;
  const pubDate = pubStr ? new Date(pubStr) : null;
  if (!pubDate || isNaN(pubDate)) { stats.undated++; continue; }
  if (pubDate < cutoff) { stats.tooOld++; continue; }

  seen.add(url);
  kept.push({ ...item, url });
}

// Sort by score (desc) then by date (desc) so per-host cap keeps the best
kept.sort((a, b) => {
  const sa = typeof a.score === 'number' ? a.score : 0.5;
  const sb = typeof b.score === 'number' ? b.score : 0.5;
  if (sb !== sa) return sb - sa;
  const ta = new Date(a.published || a.pubDate || 0).getTime() || 0;
  const tb = new Date(b.published || b.pubDate || 0).getTime() || 0;
  return tb - ta;
});

// Per-host cap
const hostCount = {};
const afterHostCap = [];
for (const item of kept) {
  const h = hostnameOf(item.url);
  hostCount[h] = (hostCount[h] || 0) + 1;
  if (hostCount[h] > maxPerHost) { stats.hostCapped++; continue; }
  afterHostCap.push(item);
}

// Final sort: newest first (more useful for downstream rendering)
afterHostCap.sort((a, b) => {
  const ta = new Date(a.published || a.pubDate || 0).getTime() || 0;
  const tb = new Date(b.published || b.pubDate || 0).getTime() || 0;
  return tb - ta;
});

const capped = limit > 0 ? afterHostCap.slice(0, limit) : afterHostCap;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(capped, null, 2));

// Persist URLs we kept so they don't resurface tomorrow
for (const item of capped) seenUrls.add(item.url);
fs.mkdirSync(path.dirname(seenUrlsFile), { recursive: true });
fs.writeFileSync(seenUrlsFile, JSON.stringify([...seenUrls], null, 2));

const limitMsg = limit > 0 && capped.length === limit ? `, capped to ${limit}` : '';
console.log(
  `merge: ${stats.in} in → ${capped.length} out${limitMsg} → ${outFile}\n` +
  `       drops: dup-url=${stats.dupUrl}, low-score(<${minScore})=${stats.lowScore}, non-ai=${stats.nonAi}, ` +
  `undated=${stats.undated}, too-old(>${days}d)=${stats.tooOld}, ` +
  `host-cap(>${maxPerHost})=${stats.hostCapped}`
);
