const fs = require('fs');

const keywords = JSON.parse(fs.readFileSync('/home/rosamund/.openclaw/workspace/ai-daily/search-keywords.json'));
const seenUrls = new Set(JSON.parse(fs.readFileSync('/home/rosamund/.openclaw/workspace/ai-daily/seen-urls.json')));
const seenEvents = JSON.parse(fs.readFileSync('/home/rosamund/.openclaw/workspace/ai-daily/seen-events.json'));

const API_KEY1 = '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';
const API_KEY2 = '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';
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
  
  fs.writeFileSync('/home/rosamund/.openclaw/workspace/ai-daily/tavily-results.json', JSON.stringify(uniqueResults, null, 2));
  console.log(`Found ${uniqueResults.length} new unique articles.`);
}

main();