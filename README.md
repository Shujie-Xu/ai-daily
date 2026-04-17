# AI Daily

每日 AI 新闻摘要 — 自动抓取、渲染、推送至 GitHub Pages。

## 架构

```
config/sources.yaml          ← 所有数据源、RSS 地址、搜索维度
config/prompts/daily-run.md  ← agent 日常运行入口提示词
src/fetch/                   ← 数据抓取脚本
src/pipeline/                ← 合并、去重、清理
src/render/                  ← HTML 生成
state/                       ← 跨次去重状态（seen-urls.json, seen-events.json）
tmp/                         ← 中间产物（不提交）
docs/                        ← 静态站点输出（gh-pages 分支，不在 main）
```

## 目录结构

```
ai-daily/
├── config/
│   ├── sources.yaml          # 数据源 + 搜索维度（主配置）
│   ├── entities.yaml         # 实体追踪列表
│   └── prompts/
│       └── daily-run.md      # 日常 agent 运行提示词
├── src/
│   ├── fetch/
│   │   ├── tavily.js         # Tavily 搜索抓取
│   │   ├── rss.js            # RSS 批量抓取
│   │   ├── parallel.js       # 并行内容抓取
│   │   └── weak-signal.js    # 弱信号查询生成
│   ├── pipeline/
│   │   ├── merge.js          # 合并 + 去重 + 时间窗口过滤
│   │   ├── clean-events.js   # 清理过期 seen-events
│   │   └── clean-audio.js    # 清理过期音频文件
│   └── render/
│       └── generate.js       # HTML 渲染 + 推送 gh-pages
├── state/
│   ├── seen-urls.json        # 跨次去重 URL 集合
│   ├── seen-events.json      # 跨次去重事件集合
│   └── source-health.json    # RSS 源健康状态
├── .env.example              # 环境变量示例
├── .gitignore
└── package.json
```

## 常见改动去哪改

| 需要改什么 | 改哪个文件 |
|---|---|
| 添加/删除新闻源或 RSS | `config/sources.yaml` → `sites` |
| 调整搜索维度或关键词 | `config/sources.yaml` → `dimensions` |
| 追踪新实体（公司/人物） | `config/entities.yaml` |
| 修改 agent 日常提示词 | `config/prompts/daily-run.md` |
| 修改搜索参数（深度、时间窗口） | `config/sources.yaml` → `search_api` |

## 本地运行

```bash
cp .env.example .env        # 填入 API keys
npm install

npm run fetch               # Tavily 搜索抓取 → tmp/tavily-results.json
npm run fetch:rss           # RSS 批量抓取 → tmp/rss.json
npm run merge tmp/tavily-results.json tmp/rss.json  # 合并去重 → tmp/merged.json
npm run render              # 生成 HTML → docs/
npm run render:push         # 生成 HTML + 推送 gh-pages
```

## 防熵规则

- **不要把 `tmp/` 或 `docs/` 提交到 main 分支** — `.gitignore` 已排除
- **`docs/` 只在 gh-pages 分支** — `generate.js --push` 自动处理
- **API keys 只放 `.env`，绝不进 git** — `.env` 已在 `.gitignore`
- **新数据源先加 `config/sources.yaml`，不要散落在脚本里**

## GitHub Pages

静态站点在 `gh-pages` 分支的 `docs/` 目录下。

- repo Settings → Pages → Source: `gh-pages` 分支，`/docs` 目录
- `npm run render:push` 自动提交并推送 gh-pages
- 音频文件由 GitHub Actions `clean-audio.yml` 定期清理（保留 45 天）
