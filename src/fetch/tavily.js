#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');  // repo root

// ── Key validation ──────────────────────────────────────────────────────────
const API_KEY1 = process.env.TAVILY_API_KEY_1;
const API_KEY2 = process.env.TAVILY_API_KEY_2;
if (!API_KEY1 || !API_KEY2) {
  console.error('ERROR: TAVILY_API_KEY_1 and TAVILY_API_KEY_2 must be set in .env');
  process.exit(1);
}

const keywords   = JSON.parse(fs.readFileSync(path.join(ROOT, 'search-keywords.json')));
const seenUrls   = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'seen-urls.json'))));
const seenEvents = JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'seen-events.json')));

let currentKey = API_KEY1;

async function fetchTavily(query) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch("https://api.tavily.com/search", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: currentKey,
          query: query,
          search_depth: "basic",
          max_results: 8,
          days: 1
        })
      });
      const data = await res.json();
      if (data.error && data.error.includes("429")) {
        currentKey = API_KEY2;
        continue;
      }
      return data.results || [];
    } catch (err) {
      console.error(err);
    }
  }
  return [];
}

async function main() {
  const queries = keywords.dimensions.flatMap(d => d.queries);
  let allResults = [];

  console.log(`Starting search for ${queries.length} queries...`);
  for (const q of queries) {
    const results = await fetchTavily(q);
    allResults.push(...results);
  }

  // Deduplicate by URL
  const uniqueResults = [];
  const urls = new Set();
  for (const r of allResults) {
    if (!urls.has(r.url) && !seenUrls.has(r.url)) {
      urls.add(r.url);
      uniqueResults.push(r);
    }
  }

  fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'tmp', 'tavily-results.json'), JSON.stringify(uniqueResults, null, 2));
  console.log(`Found ${uniqueResults.length} new unique articles.`);
}

main();
