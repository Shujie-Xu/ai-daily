#!/usr/bin/env node
/**
 * weak-signal.js — Generate targeted Tavily queries for the entity watchlist.
 *
 * Reads:  config/entities.yaml (entities, themes, search_templates)
 * Writes: tmp/weak-signal-queries.json
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT     = path.resolve(__dirname, '../..');
const cfgPath  = path.join(ROOT, 'config', 'entities.yaml');
const outPath  = path.join(ROOT, 'tmp', 'weak-signal-queries.json');
const cfg      = yaml.load(fs.readFileSync(cfgPath, 'utf8'));

const unique = list => [...new Set(list.filter(Boolean))];

function expand(entityName, siteHints, templates, themes) {
  const out = [];
  for (const theme of themes) {
    for (const tpl of templates) {
      if (tpl.includes('{site}')) {
        for (const site of siteHints) {
          out.push(tpl.replaceAll('{entity}', entityName).replaceAll('{theme}', theme).replaceAll('{site}', site));
        }
      } else {
        out.push(tpl.replaceAll('{entity}', entityName).replaceAll('{theme}', theme));
      }
    }
  }
  return out;
}

const targeted = (cfg.entities || []).map(e => ({
  entity:  e.name,
  queries: unique(expand(e.name, e.site_hints || [], cfg.search_templates || [], cfg.themes || [])),
}));

const generated = {
  generated_at:      new Date().toISOString(),
  targeted_entities: targeted,
  all_queries:       unique(targeted.flatMap(t => t.queries)),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(generated, null, 2));
console.log(`weak-signal: ${generated.all_queries.length} queries → ${outPath}`);
