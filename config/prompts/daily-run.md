# AI Daily — 每日主流程

<!-- TODO: 用户自己写这个文件 -->
<!-- 这是 agent 执行每日 AI 日报的入口 prompt。 -->
<!-- 参考 src/ 里的各个工具组件，按需调用。 -->

<!-- 建议包含的步骤：
1. 从 config/sources.yaml 读取配置，调用 src/fetch/tavily.js 搜索
2. 可选：调用 src/fetch/rss.js 补充 RSS 源
3. 调用 src/pipeline/merge.js 合并去重
4. 调用 src/fetch/parallel.js 抓取文章正文
5. 筛选、评分、撰写摘要
6. 调用 src/render/generate.js 渲染 HTML（--push 推送 GitHub Pages）
7. 发送到家庭群
-->
