#!/usr/bin/env node
/**
 * rss.js — Fetch articles from RSS sources defined in config/sources.yaml
 *
 * Usage:
 *   node src/fetch/rss.js [--window=48h] [--out=tmp/rss.json]
 *
 * Output: JSON array of { title, url, published, source, lang }
 * Failed sources are logged to state/source-health.json (non-blocking).
 */
'use strict';
const fs      = require('fs');
const path    = require('path');
const yaml    = require('js-yaml');
const Parser  = require('rss-parser');

const ROOT    = path.resolve(__dirname, '../..');
const args    = process.argv.slice(2);
const windowH = parseInt((args.find(a => a.startsWith('--window=')) || '--window=48h').split('=')[1], 10) || 48;
const outFile = (args.find(a => a.startsWith('--out=')) || '').split('=')[1] || path.join(ROOT, 'tmp', 'rss.json');
const healthFile = path.join(ROOT, 'state', 'source-health.json');

const cfg    = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'sources.yaml'), 'utf8'));
const cutoff = new Date(Date.now() - windowH * 3600 * 1000);
// Reddit + some CDNs reject generic user agents — use a browser UA for compatibility.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const parser = new Parser({
  timeout: 20000,  // 20s — Vercel free tier function cap is 10s; we add buffer for TLS/DNS
  headers: {
    'User-Agent': UA,
    'Accept':     'application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
  },
});

const sources = Object.values(cfg.sites).flat().filter(s => s.rss);

async function fetchOnce(source) {
  const feed = await parser.parseURL(source.rss);
  return (feed.items || [])
    .filter(item => {
      const pub = item.pubDate ? new Date(item.pubDate) : null;
      return pub && pub >= cutoff;
    })
    .map(item => ({
      title:     item.title || '',
      url:       item.link  || '',
      published: item.pubDate || '',
      source:    source.name,
      lang:      source.lang || 'en',
    }));
}

// Single retry for transient failures (Vercel cold-start, network blips)
async function fetchSource(source) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const items = await fetchOnce(source);
      return { ok: true, source: source.name, items };
    } catch (err) {
      if (attempt === 2) return { ok: false, source: source.name, error: err.message, items: [] };
    }
  }
}

async function main() {
  console.log(`rss: fetching ${sources.length} sources (window=${windowH}h, cutoff=${cutoff.toISOString()})`);

  const results = await Promise.all(sources.map(fetchSource));

  // Write health log
  const health = {};
  try { Object.assign(health, JSON.parse(fs.readFileSync(healthFile, 'utf8'))); } catch {}
  for (const r of results) {
    health[r.source] = r.ok
      ? { status: 'ok',    last_ok: new Date().toISOString(), items: r.items.length }
      : { status: 'error', last_error: new Date().toISOString(), error: r.error };
  }
  fs.mkdirSync(path.dirname(healthFile), { recursive: true });
  fs.writeFileSync(healthFile, JSON.stringify(health, null, 2));

  // Aggregate
  const allItems = results.flatMap(r => r.items);
  const failed   = results.filter(r => !r.ok);
  console.log(`rss: ${allItems.length} items from ${results.length - failed.length} sources; ${failed.length} failed`);
  if (failed.length) console.log('  failed:', failed.map(r => r.source).join(', '));

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(allItems, null, 2));
  console.log(`rss: wrote ${allItems.length} items → ${outFile}`);
}

main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
