#!/usr/bin/env node
/**
 * dedup.js — AI 日报去重辅助脚本（纯程序化，无需 API key）
 *
 * 职责：
 *   1. 读取 latest-news.json（候选）和 seen-events.json（历史指纹）
 *   2. 精确标题匹配去重（不需要 AI）
 *   3. 输出给 subagent 用的结构化数据文件 /tmp/dedup-input.json
 *   4. --apply 模式：读取 subagent 写入的 /tmp/dedup-result.json，应用到 latest-news.json
 *
 * 用法：
 *   node dedup.js             → 生成 /tmp/dedup-input.json（供 subagent 读取）
 *   node dedup.js --apply     → 应用 /tmp/dedup-result.json 到 latest-news.json
 *   node dedup.js --dry-run   → 预览，不写文件
 */

const fs = require('fs');
const path = require('path');

const DIR = path.dirname(process.argv[1]) || __dirname;
const NEWS_PATH = path.join(DIR, 'latest-news.json');
const SEEN_PATH = path.join(DIR, 'seen-events.json');
const INPUT_PATH = '/tmp/dedup-input.json';
const RESULT_PATH = '/tmp/dedup-result.json';

const DRY_RUN = process.argv.includes('--dry-run');
const APPLY = process.argv.includes('--apply');

// ── 工具：规范化标题（去空格、标点、大小写）
function normalize(title) {
  return title.replace(/[\s\u3000，。！？、：；「」【】""''《》\-_\/\\]/g, '').toLowerCase();
}

// ── 精确匹配去重（阶段一，快速过滤标题完全相同的）
function exactDedup(candidates, activeSeen) {
  const seenNorm = new Set(activeSeen.map(e => normalize(e.title)));
  const keep = [], removed = [];
  candidates.forEach((c, i) => {
    if (seenNorm.has(normalize(c.title))) {
      removed.push({ idx: i, title: c.title, reason: '精确标题匹配' });
    } else {
      keep.push(i);
    }
  });
  return { keep, removed };
}

async function main() {
  const news = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf8'));
  const seen = JSON.parse(fs.readFileSync(SEEN_PATH, 'utf8'));

  // 只取未过期的指纹
  const today = new Date().toISOString().slice(0, 10);
  const activeSeen = seen.filter(e => e.expires >= today);

  if (news.articles.length === 0) {
    console.log('⚠️ 没有候选文章，跳过去重');
    process.exit(0);
  }

  if (APPLY) {
    // ── Apply 模式：读取 subagent 的判断结果并写回
    if (!fs.existsSync(RESULT_PATH)) {
      console.error('❌ 找不到 /tmp/dedup-result.json，subagent 可能未完成');
      process.exit(1);
    }
    const result = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8'));
    const keep = new Set(result.keep || []);
    const removed = result.removed || [];

    console.log(`\n✅ 保留 ${keep.size} 篇，去除 ${removed.length} 篇：`);
    removed.forEach(r => {
      const title = news.articles[r.idx]?.title?.slice(0, 40) || '?';
      console.log(`   ❌ [${r.idx}] ${title} → ${r.reason}`);
    });

    if (!DRY_RUN) {
      news.articles = news.articles.filter((_, i) => keep.has(i));
      fs.writeFileSync(NEWS_PATH, JSON.stringify(news, null, 2));
      console.log(`\n📝 已写回 ${NEWS_PATH}（${news.articles.length} 篇）`);
    } else {
      console.log('\n🔍 dry-run，不写文件');
    }
    return;
  }

  // ── 准备模式：精确去重 + 生成 subagent 输入文件
  const candidates = news.articles.map((a, i) => ({
    idx: i, title: a.title, summary: a.summary || ''
  }));

  // 阶段一：精确匹配（免 AI）
  const { keep: keepAfterExact, removed: exactRemoved } = exactDedup(candidates, activeSeen);

  if (exactRemoved.length > 0) {
    console.log(`\n🔍 精确匹配去除 ${exactRemoved.length} 篇：`);
    exactRemoved.forEach(r => console.log(`   ❌ [${r.idx}] ${r.title.slice(0, 45)}`));
  }

  // 剩余候选（精确匹配没过滤的）送给 subagent 做语义判断
  const semanticCandidates = keepAfterExact.map(i => candidates[i]);

  if (semanticCandidates.length === 0) {
    // 精确去重已过滤完，直接应用
    console.log('✅ 精确去重已处理完所有重复，无需语义判断');
    const result = { keep: [], removed: exactRemoved };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.log('💾 已写入 /tmp/dedup-result.json，运行 --apply 应用');
    return;
  }

  // 生成 subagent 输入文件
  const input = {
    exactRemoved,          // 精确匹配已去除的
    candidates: semanticCandidates,   // 待语义判断的候选
    seen: activeSeen.map(e => ({ title: e.title, date: e.date }))
  };

  fs.writeFileSync(INPUT_PATH, JSON.stringify(input, null, 2));
  console.log(`\n📋 精确去重后剩余 ${semanticCandidates.length} 篇需语义判断`);
  console.log(`💾 输入数据已写入 ${INPUT_PATH}`);
  console.log(`\n⏭️  下一步：spawn subagent 读取 ${INPUT_PATH} 做语义去重，结果写入 ${RESULT_PATH}`);
  console.log(`   然后运行：node dedup.js --apply`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
