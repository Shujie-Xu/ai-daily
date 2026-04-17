#!/usr/bin/env node
/**
 * record-events.js — Append today's published events to seen-events.json.
 *
 * Reads:  latest-news.json (default, override with --in=PATH)
 * Updates: state/seen-events.json (appends new fingerprints, 14-day expire by default)
 *
 * Each event entry: { id, title, date, expires }
 *   id       : slug derived from title (kept short; conflicts get a suffix)
 *   title    : original article title (used for normalized matching by dedup-events.js)
 *   date     : today (YYYY-MM-DD)
 *   expires  : today + --ttl-days (default 14)
 *
 * Usage:
 *   node src/pipeline/record-events.js
 *   node src/pipeline/record-events.js --in=foo.json --ttl-days=21
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
const inFile   = argVal('--in', path.join(ROOT, 'latest-news.json'));
const ttlDays  = parseInt(argVal('--ttl-days', '14'), 10);
const seenFile = path.join(ROOT, 'state', 'seen-events.json');

const today    = new Date().toISOString().slice(0, 10);
const expires  = new Date(Date.now() + ttlDays * 86_400_000).toISOString().slice(0, 10);

function slugify(s) {
  return (s || 'event')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'event';
}

const news = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const articles = news.articles || [];

let seen = [];
try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')); } catch {}
const existingIds = new Set(seen.map(e => e.id));

let added = 0;
for (const a of articles) {
  if (!a.title) continue;
  let id = slugify(a.title);
  let i = 1;
  while (existingIds.has(id)) { id = `${slugify(a.title)}-${++i}`; }
  existingIds.add(id);
  seen.push({ id, title: a.title, date: today, expires });
  added++;
}

fs.writeFileSync(seenFile, JSON.stringify(seen, null, 2));
console.log(`record-events: +${added} → ${seen.length} total in seen-events.json (expires ${expires})`);
