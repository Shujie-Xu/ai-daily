#!/usr/bin/env node
/**
 * search.js — Run all dimension queries via Tavily; on quota exhaustion fall back to Brave.
 *
 * Reads:  config/sources.yaml (search_api, sites, dimensions)
 * Reads:  state/seen-urls.json (cross-run dedup)
 * Writes: tmp/search-results.json
 *
 * Output schema (Tavily-compatible, also produced by the Brave adapter):
 *   { url, title, content, score, published }
 *
 * Strategy:
 *   1. Try Tavily (key1 → key2 rotation on quota).
 *   2. When both Tavily keys are exhausted, switch to Brave for all remaining queries.
 *   3. If Brave is unavailable too, log + continue (downstream merge.js will see fewer items).
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '../..');
const TAVILY_KEY1 = process.env.TAVILY_API_KEY_1;
const TAVILY_KEY2 = process.env.TAVILY_API_KEY_2;
const BRAVE_KEY   = process.env.BRAVE_API_KEY;
if (!TAVILY_KEY1 && !BRAVE_KEY) {
  console.error('ERROR: need TAVILY_API_KEY_1 (preferred) or BRAVE_API_KEY in .env');
  process.exit(1);
}

const cfg      = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'sources.yaml'), 'utf8'));
const seenSet  = new Set(readJsonOr(path.join(ROOT, 'state', 'seen-urls.json'), []));
const api      = cfg.search_api || {};

function readJsonOr(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function buildTier1Queries(sites) {
  const tier1 = Object.values(sites).flat().filter(s => s.tier === 1 && s.site);
  return tier1.map(s => `site:${s.site} AI OR robotics latest`);
}

function collectQueries() {
  const queries = [];
  for (const dim of cfg.dimensions || []) {
    if (dim.auto_from_tier1) queries.push(...buildTier1Queries(cfg.sites || {}));
    else queries.push(...(dim.queries || []));
  }
  return queries;
}

// ── Tavily ────────────────────────────────────────────────────────────────────
let tavilyKey = TAVILY_KEY1;
let tavilyDead = !TAVILY_KEY1;

function tavilyQuotaExceeded(data) {
  const detail = data && data.detail && data.detail.error;
  if (typeof detail === 'string' && /usage limit|exceeds|rate limit/i.test(detail)) return true;
  if (data && data.error && String(data.error).includes('429')) return true;
  return false;
}

async function tavilySearch(query) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          api_key:      tavilyKey,
          query,
          search_depth: api.search_depth || 'basic',
          max_results:  api.max_results  || 8,
          time_range:   api.time_range   || 'week',
        }),
      });
      const data = await res.json();
      if (tavilyQuotaExceeded(data)) {
        if (api.key_rotation && tavilyKey !== TAVILY_KEY2 && TAVILY_KEY2) {
          console.warn('search: tavily key1 over quota → switching to key2');
          tavilyKey = TAVILY_KEY2;
          continue;
        }
        console.warn('search: both tavily keys exhausted → will fall back to brave');
        tavilyDead = true;
        return null;  // signal caller to fall back
      }
      if (data.error) {
        console.error(`tavily error: ${query} → ${JSON.stringify(data.error)}`);
        return [];
      }
      return (data.results || []).map(r => ({
        url:       r.url,
        title:     r.title,
        content:   r.content,
        score:     r.score,
        published: r.published_date || r.published || null,
      }));
    } catch (err) {
      console.error(`tavily fetch: ${query} → ${err.message}`);
    }
  }
  return [];
}

// ── Brave ─────────────────────────────────────────────────────────────────────
function stripHtml(s) { return (s || '').replace(/<[^>]*>/g, ''); }

async function braveSearch(query) {
  if (!BRAVE_KEY) return [];
  const url = 'https://api.search.brave.com/res/v1/web/search' +
              `?q=${encodeURIComponent(query)}&count=${api.max_results || 8}&freshness=pw`;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY },
    });
    if (res.status === 429) {
      console.error('brave: rate limited (429)');
      return [];
    }
    if (!res.ok) {
      console.error(`brave: ${query} → HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    const results = (data.web && data.web.results) || [];
    return results.map(r => ({
      url:       r.url,
      title:     r.title,
      content:   stripHtml(r.description),
      score:     null,                // Brave has no score
      published: r.page_age || null,  // ISO timestamp when present
    }));
  } catch (err) {
    console.error(`brave fetch: ${query} → ${err.message}`);
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const queries = collectQueries();
  console.log(`search: ${queries.length} queries (primary=tavily, fallback=${BRAVE_KEY ? 'brave' : 'none'})`);

  const all = [];
  let tavilyCount = 0, braveCount = 0;

  for (const q of queries) {
    let results = null;
    if (!tavilyDead) {
      results = await tavilySearch(q);
      if (results !== null) tavilyCount += results.length;
    }
    if (results === null) {
      // Tavily died on this query → fall through to Brave
      results = await braveSearch(q);
      braveCount += results.length;
    }
    all.push(...results);
  }

  // Within-run + cross-run URL dedup
  const seenInRun = new Set();
  const out = [];
  for (const r of all) {
    if (!r.url || seenInRun.has(r.url) || seenSet.has(r.url)) continue;
    seenInRun.add(r.url);
    out.push(r);
  }

  const outFile = path.join(ROOT, 'tmp', 'search-results.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`search: tavily=${tavilyCount}, brave=${braveCount} → ${out.length} new (after URL dedup) → ${outFile}`);

  // Hard fail only if BOTH providers produced nothing — caller (systemd) needs to know
  if (tavilyCount === 0 && braveCount === 0) {
    console.error('search: no results from any provider — both quotas dead?');
    process.exit(2);
  }
}

main();
