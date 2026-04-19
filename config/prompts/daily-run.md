# AI Daily — 每日主流程

你是 ai-daily 的执行 agent。按 6 个阶段跑流程。每阶段看 stdout，有错就停下报告。

工作目录：`~/cron-jobs/ai-daily`

---

## 1. 自动抓取

```bash
cd ~/cron-jobs/ai-daily
npm run fetch        # 搜索（Tavily 主，Brave fallback）→ tmp/search-results.json
npm run fetch:rss    # RSS 批量 → tmp/rss.json
```

（`npm run fetch:weak` 暂不并入主流程。）

## 2. 规则过滤

```bash
npm run merge -- tmp/search-results.json tmp/rss.json
```

merge.js 会做：URL 去重（含跨次 `state/seen-urls.json`）、Tavily score ≥ 0.5、过去 1 天、同 host 最多 3 条、无日期的丢掉。

stdout 末尾：`merge: X in → Y out`。输出到 `tmp/merged.json`（数组，每条有 url/title/content/score/published）。

## 3. LLM 去重 — 外包给 engineer（严谨判断）

把去重交给 `engineer` subagent（代码专家擅长结构化模式匹配）。你需要：

1. 读两份数据并拼成它的 prompt：
   - `tmp/merged.json`（候选）
   - `state/seen-events.json` 里 14 天内未过期事件（`expires >= 今天`）

2. 调用：
   ```bash
   bash ~/.local/bin/delegate engineer "<完整 prompt>"
   ```

prompt 必须明确两类去重：
- **A. 指纹库重复**：候选标题/核心事件和库里已有事件**同一件事**（语义判断，不看字面）。例如库里 "OpenAI 发布 Codex 升级"，今天 "OpenAI Codex 支持后台操作电脑" 是同事件跟进 → 丢弃。
- **B. 当天多源重复**：候选内部同事件多家报道。同事件只保留最权威或最详细那条（官方 > tier1 > tier2 > 社区；body 长 > 短）。
- **C. AI 相关性过滤**：顺手过滤明显偏离 AI/科技主线的新闻，但口径放宽——凡与 AI、芯片、算力、机器人、自动驾驶、云/数据中心、开发者工具或科技公司并购融资明显相关的都保留。

要求 gpt5.4 输出 JSON 数组（保留下来的条目，原字段不变），你接收后写到 `tmp/final-candidates.json`，同时在回复里报告：

```
dedup: N in → M out
  · 指纹库命中并丢弃: [标题列表，最多 5 条]
  · 当天多源合并: [保留的 → 合并掉的，示例 3 组]
```

**Fallback**：如果 engineer 超时（>10 min）/ 报错 / 输出格式坏 / 返回空 → 你（主 agent）自己做，按上面 A/B 规则判断后写 `tmp/final-candidates.json`，不要中断流程。

## 4.5 正文抓取（脚本，对 final-candidates 跑）

```bash
npm run fetch:bodies -- tmp/final-candidates.json
```

parallel.js 并行抓每条 url 的正文（提取 `<article>/<main>`，最多 10KB），**原地** 给 final-candidates 加 `body_text`。失败的留空字符串。放在 dedup 之后做 = 不浪费抓后面会被淘汰掉的文章。

## 5. 按 schema 写作 — 外包给 poet（中文写作专员）

把写作交给 `poet` subagent。一次性把所有候选给它，让它批量产出 articles 数组。

prompt 必须包含：

1. **schema 规范**：
   ```json
   {
     "title":        "<原标题或更清晰的中文重写>",
     "summary":      "<1-2 句话要点，抓住核心事件>",
     "full_content": "<4-6 句展开，保留具体数字 / 人名 / 时间 / 金额 / 产品名>",
     "context":      "<可选，1-2 句背景：为啥重要 / 和什么关联>",
     "url":          "<原 url>",
     "categories":   ["model" | "funding" | "policy" | "embodied" | "research" | "product" | ...],
     "tags":         ["OpenAI", "Claude", ...],
     "heat":         1-5
   }
   ```

2. **写作规范**（一定要写进 prompt 里）：
   - `full_content` 平均 200-400 字（不是 100 字）
   - 每条必含至少 1 个具体事实（数字 / 人名 / 时间 / 金额 / 产品代号）
   - body_text 为空时用 content snippet + 背景知识，末尾注 "(基于摘要)"
   - context 没东西可补就省略
   - 输出**只有** JSON 数组，无前后说明文字

3. **输入数据**：把 `tmp/final-candidates.json` 完整内容拼进 prompt（每条带 body_text）

调用：
```bash
bash ~/.local/bin/delegate poet "<完整 prompt>"
```

接收 sonnet 返回的 JSON 数组，包成 `{ "date": "YYYY-MM-DD", "articles": [...] }` 写到仓库根目录的 `latest-news.json`。

**Fallback**：poet 超时（>10 min）/ 报错 / 返回非 JSON → 你（主 agent）自己按 schema 写，规范一致，不要中断。

## 6. Push + 指纹库更新

```bash
node src/render/generate.js latest-news.json --push
npm run record:events
```

`generate.js --push` 渲染 `docs/` + 通过 worktree 推到 gh-pages 分支，末尾应有 `🚀 已推送到 gh-pages`。
`record:events` 把今天的事件追加到 `state/seen-events.json`（14 天过期）。

---

## 完成时报告（格式固定）

```
抓取 X → 规则过滤 Y → 去重后 M → 日报写入 M 篇 → 推送 ✅
去重命中指纹库 a 条 / 合并多源 b 组
```

## 注意

- **不要** 修改 config/ 下的文件
- **不要** commit 到 main 分支
- 出错时先看 `state/source-health.json`（RSS 源健康）
- 想调 merge 参数：`npm run merge -- --min-score=0.6 --max-per-host=2 --days=2 tmp/search-results.json tmp/rss.json`
