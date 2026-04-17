#!/usr/bin/env node
/**
 * backfill-events.js — Append historical daily-digest titles to seen-events.json.
 *
 * Reads each docs/data/<date>.json from the local gh-pages branch (via `git show`)
 * and appends each article title as a fingerprint with the original date.
 * Useful when record-events.js was missing in the past and the library has gaps.
 *
 * Usage:
 *   node src/pipeline/backfill-events.js 2026-04-14 2026-04-15 2026-04-16
 *   node src/pipeline/backfill-events.js --range=2026-04-14:2026-04-16
 *   node src/pipeline/backfill-events.js --branch=origin/gh-pages 2026-04-14
 *
 * Each appended entry expires 14 days after the original date.
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT     = path.resolve(__dirname, '../..');
const seenFile = path.join(ROOT, 'state', 'seen-events.json');
const args     = process.argv.slice(2);
const argVal   = (flag, dflt) => {
  const a = args.find(x => x.startsWith(`${flag}=`));
  return a ? a.split('=')[1] : dflt;
};
const branch   = argVal('--branch', 'origin/gh-pages');
const ttlDays  = parseInt(argVal('--ttl-days', '14'), 10);

// Collect dates: explicit args + --range=A:B expansion
const dates = [];
for (const a of args.filter(x => !x.startsWith('--'))) dates.push(a);
const range = argVal('--range', '');
if (range) {
  const [a, b] = range.split(':');
  let cur = new Date(a);
  const end = new Date(b);
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

if (dates.length === 0) {
  console.error('usage: backfill-events.js <YYYY-MM-DD> [...] | --range=YYYY-MM-DD:YYYY-MM-DD [--branch=origin/gh-pages]');
  process.exit(1);
}

function slugify(s) {
  return (s || 'event')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'event';
}

let seen = [];
try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')); } catch {}
const existingIds = new Set(seen.map(e => e.id));
const existingTitlesByDate = new Set(seen.map(e => `${e.date}|${e.title}`));

let totalAdded = 0;
for (const date of dates) {
  const ref = `${branch}:docs/data/${date}.json`;
  let json;
  try {
    const raw = execSync(`git -C "${ROOT}" show ${ref}`, { stdio: ['ignore', 'pipe', 'pipe'] });
    json = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    console.warn(`backfill: ${date} not found (${ref})`);
    continue;
  }

  const articles = json.articles || [];
  const expires  = new Date(new Date(date).getTime() + ttlDays * 86_400_000)
                     .toISOString().slice(0, 10);
  let added = 0;
  for (const a of articles) {
    if (!a.title) continue;
    if (existingTitlesByDate.has(`${date}|${a.title}`)) continue;
    let id = slugify(a.title);
    let i = 1;
    while (existingIds.has(id)) { id = `${slugify(a.title)}-${++i}`; }
    existingIds.add(id);
    existingTitlesByDate.add(`${date}|${a.title}`);
    seen.push({ id, title: a.title, date, expires });
    added++;
  }
  console.log(`backfill: ${date} +${added} (expires ${expires})`);
  totalAdded += added;
}

fs.writeFileSync(seenFile, JSON.stringify(seen, null, 2));
console.log(`backfill: total +${totalAdded} → ${seen.length} entries in seen-events.json`);
