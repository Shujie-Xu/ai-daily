#!/usr/bin/env node
/**
 * dedup.js — AI 日报事件级语义去重
 *
 * 读取 latest-news.json（候选）和 seen-events.json（指纹库），
 * 调用 Claude API 做语义判断，输出 keep 列表并过滤 latest-news.json。
 *
 * 用法：node dedup.js [--dry-run]
 *   --dry-run  只打印结果，不写文件
 */

const fs = require('fs');
const path = require('path');

const DIR = path.dirname(process.argv[1]) || __dirname;
const NEWS_PATH = path.join(DIR, 'latest-news.json');
const SEEN_PATH = path.join(DIR, 'seen-events.json');
const DRY_RUN = process.argv.includes('--dry-run');

// ── 读取 API key ──
function getApiKey() {
  // 1. 环境变量
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  // 2. OpenClaw auth-profiles.json
  try {
    const ap = JSON.parse(fs.readFileSync(
      path.join(process.env.HOME, '.openclaw/agents/main/agent/auth-profiles.json'), 'utf8'
    ));
    const p = ap.profiles?.['anthropic:default'] || {};
    return p.token || p.apiKey || p.credentials?.token || '';
  } catch { return ''; }
}

async function main() {
  const apiKey = getApiKey().trim();
  if (!apiKey) { console.error('❌ No Anthropic API key found'); process.exit(1); }

  const news = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf8'));
  const seen = JSON.parse(fs.readFileSync(SEEN_PATH, 'utf8'));

  // 只取未过期的指纹
  const today = new Date().toISOString().slice(0, 10);
  const activeSeen = seen.filter(e => e.expires >= today);

  if (news.articles.length === 0) {
    console.log('⚠️ 没有候选文章，跳过去重');
    process.exit(0);
  }

  if (activeSeen.length === 0) {
    console.log('✅ 指纹库为空，全部保留（' + news.articles.length + ' 篇）');
    process.exit(0);
  }

  // 构造候选列表（精简字段）
  const candidates = news.articles.map((a, i) => ({
    idx: i, title: a.title, summary: a.summary
  }));

  // 构造 prompt
  const prompt = `你是去重判断员。判断候选新闻是否与事件指纹库中的事件重复。

判断规则：
- 如果候选新闻与指纹库中某条事件描述的是「同一件事」（相同公司/主体 + 相同事件类型），则标记为重复
- 判断维度：融资=相同公司+融资事件 / 产品发布=相同公司+同一产品 / 政策=相同法规/机构+同一政策动向
- 「同一事件的后续报道/不同角度」也算重复
- 不同公司、不同事件类型 → 不重复
- 宽松判断：如果不确定，偏向保留

候选新闻：
${JSON.stringify(candidates, null, 2)}

事件指纹库（${activeSeen.length} 条）：
${JSON.stringify(activeSeen.map(e => ({ title: e.title, date: e.date })), null, 2)}

输出纯 JSON（不要 markdown code fence，不要任何额外文字）：
{"keep":[0,1,3],"removed":[{"idx":2,"reason":"与指纹库 'xxx' 描述同一事件"}]}`;

  console.log(`📋 候选 ${candidates.length} 篇，指纹库 ${activeSeen.length} 条`);
  console.log('🤖 调用 Claude API 做语义去重...');

  // 调用 Anthropic Messages API（用 haiku 即可，便宜快速）
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('❌ API 错误:', res.status, err);
    process.exit(1);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || '';

  // 解析 JSON（容忍 markdown fence）
  let result;
  try {
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    result = JSON.parse(jsonStr);
  } catch (e) {
    console.error('❌ 无法解析返回结果:', text.slice(0, 500));
    process.exit(1);
  }

  const keep = new Set(result.keep || []);
  const removed = result.removed || [];

  console.log(`\n✅ 保留 ${keep.size} 篇，去除 ${removed.length} 篇：`);
  removed.forEach(r => console.log(`   ❌ [${r.idx}] ${candidates[r.idx]?.title?.slice(0, 40)} → ${r.reason}`));
  console.log('   保留:');
  news.articles.forEach((a, i) => { if (keep.has(i)) console.log(`   ✅ [${i}] ${a.title.slice(0, 50)}`); });

  if (DRY_RUN) {
    console.log('\n🔍 dry-run 模式，不写文件');
    process.exit(0);
  }

  // 过滤并写回
  news.articles = news.articles.filter((_, i) => keep.has(i));
  fs.writeFileSync(NEWS_PATH, JSON.stringify(news, null, 2));
  console.log(`\n📝 已写回 ${NEWS_PATH}（${news.articles.length} 篇）`);

  // 打印 token 用量
  const usage = data.usage || {};
  console.log(`💰 tokens: in=${usage.input_tokens || '?'} out=${usage.output_tokens || '?'}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
