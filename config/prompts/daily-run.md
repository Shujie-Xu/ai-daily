# AI Daily — 每日主流程

你是 ai-daily 的执行 agent。按下面顺序跑流程。每一步看 stdout，有错就停下报告。

工作目录：`~/cron-jobs/ai-daily`

## 步骤

### 1. 抓取
```bash
cd ~/cron-jobs/ai-daily
npm run fetch          # 搜索（Tavily 主，Brave fallback）→ tmp/search-results.json
npm run fetch:rss      # RSS 批量 → tmp/rss.json
```
（`npm run fetch:weak` 暂不并入主流程，保留备用。）

### 2. 合并 + 质量过滤
```bash
npm run merge -- tmp/search-results.json tmp/rss.json
```

merge.js 默认会做：URL 去重（含跨次 seen-urls.json）、Tavily score ≥ 0.5、过去 1 天、同 host 最多 3 条、无日期且 score < 0.7 的丢掉。

stdout 末尾会报：`merge: X in → Y out` 加各种过滤理由的统计。

### 3. 你来挑 + 写摘要 → latest-news.json

读 `tmp/merged.json`，对每条**值得放进日报的**写出：
```json
{
  "title": "<原标题或更清晰的中文重写>",
  "summary": "<1-2 句话要点>",
  "full_content": "<2-4 句话展开，可分点>",
  "url": "<原 url>",
  "categories": ["model" | "funding" | "policy" | "embodied" | "research" | ...],
  "tags": ["OpenAI", "Claude", ...],
  "heat": 1-5
}
```

把这些写到 `latest-news.json`（仓库根目录）：
```json
{ "date": "YYYY-MM-DD", "articles": [ ... ] }
```

**判断原则**：
- 不强求数量，有多少质量过关就放多少。**没有就是 0 篇也行**。
- 重复事件（同一新闻多家报道）只保留最权威或最详细那条
- 跳过：纯 SEO 站、汇编页、跑题、无价值的论文目录、个人 blog 碎碎念
- heat=5 留给"这是今天最重要的事"那种

### 4. 指纹库去重

```bash
npm run dedup:events
```

会用 `state/seen-events.json` 里 14 天内已记录的事件标题，把 latest-news.json 里重复的过滤掉。stdout 会列出哪些被砍。

### 5. 渲染 + 推送
```bash
node src/render/generate.js latest-news.json --push --no-tts
```

会渲染 `docs/`，通过临时 git worktree 推到 gh-pages 分支。**测试期 --no-tts**，等流程稳了再开 TTS。

stdout 末尾应该有 `🚀 已推送到 gh-pages` 或 `🟰 docs/ 无变化`。

### 6. 把今天的事件存档

```bash
npm run record:events
```

把 latest-news.json 里今天的标题加到 `state/seen-events.json`，14 天后自动过期。

## 完成时报告

末尾输出一行：今日抓取 X、过滤后候选 Y、写入日报 Z 篇、推送是否成功。

## 注意

- 不要修改 config/ 下的文件
- 不要 commit 任何东西到 main 分支
- 出错时优先看 `state/source-health.json`（RSS 源健康状态）
- merge 的过滤参数想调？传 flag：`--min-score=0.6 --max-per-host=2 --days=2`
