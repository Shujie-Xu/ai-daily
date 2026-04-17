#!/usr/bin/env node
/**
 * clean-events.js
 * 删除 seen-events.json 中已过期的条目（expires < 今天）
 * 每次运行确定性地清理，不依赖 AI 判断
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EVENTS_FILE = path.join(ROOT, 'state', 'seen-events.json');
const today = new Date().toISOString().slice(0, 10);

let events = [];
try {
  events = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf8'));
} catch (e) {
  console.log('seen-events.json 不存在或为空，初始化为 []');
  fs.writeFileSync(EVENTS_FILE, '[]');
  process.exit(0);
}

const before = events.length;
events = events.filter(e => e.expires >= today);
const removed = before - events.length;

fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
console.log(`clean-events: 保留 ${events.length} 条，删除 ${removed} 条过期条目（today=${today}）`);
