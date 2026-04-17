#!/usr/bin/env node
/**
 * dedup-events.js — Filter out articles that match an event already in seen-events.json
 *
 * Reads:  latest-news.json (default, override with --in=PATH)
 * Reads:  state/seen-events.json (only entries where expires >= today)
 * Writes: same file in-place (or --out=PATH)
 *
 * Match: normalized exact title (whitespace, punctuation, case stripped).
 * Designed for "agent picked these candidates → filter the ones we already published".
 *
 * Usage:
 *   node src/pipeline/dedup-events.js                    in-place latest-news.json
 *   node src/pipeline/dedup-events.js --in=foo.json --out=bar.json
 *   node src/pipeline/dedup-events.js --dry-run          report what would be removed
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT  = path.resolve(__dirname, '../..');
const args  = process.argv.slice(2);
const argVal = (flag, dflt) => {
  const a = args.find(x => x.startsWith(`${flag}=`));
  return a ? a.split('=')[1] : dflt;
};
const inFile  = argVal('--in',  path.join(ROOT, 'latest-news.json'));
const outFile = argVal('--out', inFile);
const dryRun  = args.includes('--dry-run');
const seenFile = path.join(ROOT, 'state', 'seen-events.json');

function normalize(s) {
  return (s || '').replace(/[\s\u3000，。！？、：；「」【】""''《》\-_\/\\.,!?:;()[\]]/g, '').toLowerCase();
}

const news = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const seen = JSON.parse(fs.readFileSync(seenFile, 'utf8'));
const today = new Date().toISOString().slice(0, 10);
const activeSeen = seen.filter(e => e.expires >= today);
const seenNorm = new Set(activeSeen.map(e => normalize(e.title)));

const articles = news.articles || [];
const kept = [];
const removed = [];
for (const a of articles) {
  if (seenNorm.has(normalize(a.title))) {
    removed.push(a.title);
  } else {
    kept.push(a);
  }
}

console.log(`dedup-events: ${articles.length} in → ${kept.length} out (removed ${removed.length} matching ${activeSeen.length} active fingerprints)`);
for (const t of removed) console.log(`  ✂ ${t.slice(0, 70)}`);

if (!dryRun) {
  news.articles = kept;
  fs.writeFileSync(outFile, JSON.stringify(news, null, 2));
}
