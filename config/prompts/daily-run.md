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

## 3. 正文抓取

```bash
npm run fetch:bodies
```

parallel.js 会并行抓每条 url 的正文（提取 `<article>/<main>` 纯文本，最多 10KB），**原地** 给 merged.json 加 `body_text`。失败的留空字符串。

## 4. LLM 去重（本步骤由你来做，不调脚本）

读两份数据：
- `tmp/merged.json`（本次 N 条候选，带 body_text）
- `state/seen-events.json` 里 14 天内未过期的事件（`expires >= 今天`）

**两类重复都要判**：

**A. 指纹库重复** — 候选里某条的标题/核心事件，和库里已有事件（14 天内）是**同一件事**（不要求字面一致，看语义）。比如库里有 "OpenAI 发布 Codex 升级"，今天新闻是 "OpenAI Codex 支持后台操作电脑"，是同一件事的跟进报道 → 算重复，丢掉。

**B. 当天多源重复** — 候选内部，**同一事件被多家媒体报道**。看标题 + body_text 前几段判断是否同事件。同事件只保留 **一条最权威或最详细的**（优先级：官方博客 > tier1 媒体 > tier2 媒体 > 社区；body 更长更细的优先）。

去重后，把保留下来的候选写到：

```
tmp/final-candidates.json       # 数组，保留原 merged.json 的字段（url/title/content/score/published/body_text）
```

同时在回复里报告：

```
dedup: N in → M out
  · 指纹库命中并丢弃: [标题列表，最多 5 条]
  · 当天多源合并: [保留的 → 合并掉的，示例 3 组]
```

## 5. 按 schema 写作

对 `tmp/final-candidates.json` **每一条**（不再挑选），基于 body_text 展开写，按固定 schema：

```json
{
  "title":        "<原标题或更清晰的中文重写>",
  "summary":      "<1-2 句话要点，抓住核心事件>",
  "full_content": "<4-6 句展开，保留具体数字 / 人名 / 时间 / 金额 / 产品名。可 '1. ... 2. ...' 分点>",
  "context":      "<可选，1-2 句背景：这事为啥值得关注 / 和什么关联>",
  "url":          "<原 url>",
  "categories":   ["model" | "funding" | "policy" | "embodied" | "research" | "product" | ...],
  "tags":         ["OpenAI", "Claude", ...],
  "heat":         1-5
}
```

写作规范：
- `full_content` 平均 200-400 字，**不是** 100 字
- 每条必含至少 1 个具体事实（数字 / 人名 / 时间 / 金额 / 产品代号）
- 若 body_text 为空（抓取失败）则用 content snippet + 你的背景知识，full_content 可稍短并在末尾注 "(基于摘要)"
- `context` 没啥可补就省略，不强行凑

把结果写到仓库根目录的 `latest-news.json`：
```json
{ "date": "YYYY-MM-DD", "articles": [ ... ] }
```

## 6. Push + 指纹库更新

```bash
node src/render/generate.js latest-news.json --push --no-tts
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
