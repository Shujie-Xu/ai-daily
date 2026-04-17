#!/usr/bin/env node
/**
 * merge.js — Merge fetch results, deduplicate by URL, filter by recency
 *
 * Usage:
 *   node src/pipeline/merge.js <file1.json> [file2.json ...] [--days=3] [--out=tmp/merged.json]
 *
 * Input files: JSON arrays of { url, title, ... }
 * Deduplication: exact URL match against each other + state/seen-urls.json
 * Recency filter: items published within --days (default 3) kept
 * Output: merged, deduped, sorted by published date desc
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT  = path.resolve(__dirname, '../..');
const args  = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const days  = parseInt((args.find(a => a.startsWith('--days=')) || '--days=3').split('=')[1], 10);
const outFile = (args.find(a => a.startsWith('--out=')) || '').split('=')[1] || path.join(ROOT, 'tmp', 'merged.json');

if (files.length === 0) {
  console.error('usage: merge.js <file1.json> [file2.json ...] [--days=3] [--out=...]');
  process.exit(1);
}

// Load seen URLs for cross-session dedup
const seenUrlsFile = path.join(ROOT, 'state', 'seen-urls.json');
let seenUrls = new Set();
try { seenUrls = new Set(JSON.parse(fs.readFileSync(seenUrlsFile, 'utf8'))); } catch {}

const cutoff = new Date(Date.now() - days * 86_400_000);

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    return u.toString().replace(/\/$/, '');
  } catch { return url; }
}

// Merge all input files
let allItems = [];
for (const f of files) {
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    allItems.push(...(Array.isArray(data) ? data : (data.articles || data.results || [])));
  } catch (e) {
    console.warn(`merge: skipping ${f}: ${e.message}`);
  }
}

// Deduplicate and filter
const seen = new Set();
const merged = [];
for (const item of allItems) {
  const url = normalizeUrl(item.url || item.link || '');
  if (!url || seen.has(url) || seenUrls.has(url)) continue;

  const pub = item.published || item.pubDate || item.date || null;
  if (pub && new Date(pub) < cutoff) continue;

  seen.add(url);
  merged.push({ ...item, url });
}

// Sort newest first
merged.sort((a, b) => {
  const ta = new Date(a.published || a.pubDate || 0).getTime();
  const tb = new Date(b.published || b.pubDate || 0).getTime();
  return tb - ta;
});

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(merged, null, 2));
console.log(`merge: ${allItems.length} in → ${merged.length} out (deduped, last ${days}d) → ${outFile}`);
