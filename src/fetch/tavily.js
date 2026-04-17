#!/usr/bin/env node
/**
 * tavily.js — Run Tavily searches across all dimensions in config/sources.yaml
 *
 * Reads:  config/sources.yaml (search_api, sites, dimensions)
 * Reads:  state/seen-urls.json (cross-run dedup)
 * Writes: tmp/tavily-results.json
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '../..');

const API_KEY1 = process.env.TAVILY_API_KEY_1;
const API_KEY2 = process.env.TAVILY_API_KEY_2;
if (!API_KEY1 || !API_KEY2) {
  console.error('ERROR: TAVILY_API_KEY_1 and TAVILY_API_KEY_2 must be set in .env');
  process.exit(1);
}

const cfg       = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'sources.yaml'), 'utf8'));
const seenUrls  = readJsonOr(path.join(ROOT, 'state', 'seen-urls.json'), []);
const seenSet   = new Set(seenUrls);

function readJsonOr(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Auto-build site: queries from tier-1 sites for the tier1_sources dimension
function buildTier1Queries(sites) {
  const tier1 = Object.values(sites).flat().filter(s => s.tier === 1 && s.site);
  return tier1.map(s => `site:${s.site} AI OR robotics latest`);
}

function collectQueries() {
  const queries = [];
  for (const dim of cfg.dimensions || []) {
    if (dim.auto_from_tier1) {
      queries.push(...buildTier1Queries(cfg.sites || {}));
    } else {
      queries.push(...(dim.queries || []));
    }
  }
  return queries;
}

const api = cfg.search_api || {};
let currentKey = API_KEY1;

async function fetchTavily(query) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          api_key:      currentKey,
          query,
          search_depth: api.search_depth || 'basic',
          max_results:  api.max_results  || 8,
          time_range:   api.time_range   || 'week',
        }),
      });
      const data = await res.json();
      if (data.error && String(data.error).includes('429') && api.key_rotation && currentKey !== API_KEY2) {
        currentKey = API_KEY2;
        continue;
      }
      return data.results || [];
    } catch (err) {
      console.error(`tavily: ${query} → ${err.message}`);
    }
  }
  return [];
}

async function main() {
  const queries = collectQueries();
  console.log(`tavily: ${queries.length} queries`);

  const all = [];
  for (const q of queries) {
    all.push(...await fetchTavily(q));
  }

  const seenInRun = new Set();
  const out = [];
  for (const r of all) {
    if (!r.url || seenInRun.has(r.url) || seenSet.has(r.url)) continue;
    seenInRun.add(r.url);
    out.push(r);
  }

  const outFile = path.join(ROOT, 'tmp', 'tavily-results.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`tavily: ${all.length} raw → ${out.length} new → ${outFile}`);
}

main();
