#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, 'weak-signal-sources.json');
const outPath = path.join(__dirname, 'weak-signal-queries.generated.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function expandTemplates(entity, siteHints, templates, themes) {
  const queries = [];
  for (const theme of themes) {
    for (const template of templates) {
      if (template.includes('{site}')) {
        for (const site of siteHints) {
          queries.push(template.replaceAll('{entity}', entity).replaceAll('{theme}', theme).replaceAll('{site}', site));
        }
      } else {
        queries.push(template.replaceAll('{entity}', entity).replaceAll('{theme}', theme));
      }
    }
  }
  return queries;
}

const generated = {
  generated_at: new Date().toISOString(),
  communities: cfg.communities.map(group => ({
    id: group.id,
    label: group.label,
    queries: group.queries
  })),
  targeted_entities: cfg.official_watchlist.map(entity => ({
    entity,
    queries: unique(expandTemplates(entity, cfg.site_hints[entity] || [], cfg.search_templates, cfg.themes))
  }))
};

generated.all_queries = unique([
  ...generated.communities.flatMap(x => x.queries),
  ...generated.targeted_entities.flatMap(x => x.queries)
]);

fs.writeFileSync(outPath, JSON.stringify(generated, null, 2));
console.log(`wrote ${generated.all_queries.length} queries to ${outPath}`);
