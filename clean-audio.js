#!/usr/bin/env node
/**
 * clean-audio.js — 删除超过 N 天的音频文件
 * 默认保留 45 天，可通过参数 --days=N 修改
 * 用法：node clean-audio.js [--days=45] [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const AUDIO_DIR = path.join(__dirname, 'docs', 'audio');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const daysArg = args.find(a => a.startsWith('--days='));
const KEEP_DAYS = daysArg ? parseInt(daysArg.split('=')[1], 10) : 45;

const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
const cutoffStr = cutoff.toISOString().slice(0, 10);

if (!fs.existsSync(AUDIO_DIR)) {
  console.log('⚠️ audio 目录不存在，跳过');
  process.exit(0);
}

const files = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'));
let deleted = 0;
let kept = 0;
let freedBytes = 0;

for (const file of files) {
  // 从文件名提取日期，格式：2026-03-15-xxxx.mp3
  const match = file.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) { kept++; continue; }
  
  const fileDate = match[1];
  if (fileDate < cutoffStr) {
    const filePath = path.join(AUDIO_DIR, file);
    const stat = fs.statSync(filePath);
    if (DRY_RUN) {
      console.log(`  🗑️ [dry-run] ${file} (${(stat.size / 1024).toFixed(0)} KB)`);
    } else {
      fs.unlinkSync(filePath);
    }
    freedBytes += stat.size;
    deleted++;
  } else {
    kept++;
  }
}

const freedMB = (freedBytes / 1024 / 1024).toFixed(1);
console.log(`\n🎵 音频清理完成（保留 ${KEEP_DAYS} 天）`);
console.log(`   删除: ${deleted} 个文件 (${freedMB} MB)`);
console.log(`   保留: ${kept} 个文件`);
if (DRY_RUN) console.log('   ⚠️ dry-run 模式，未实际删除');
