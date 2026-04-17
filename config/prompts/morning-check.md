# AI Daily — 早安检查 + 推送家庭群

每天 10:00 触发。检查今天的 ai-daily 是否成功，分情况推送到家庭群。

家庭群：Telegram chat_id `-5242151700`（"小酪狮和小酪师"）
Bot token：从 `~/.pi/agent/telegram.json` 的 `botToken` 字段读

## 检查步骤

1. 看 systemd 日志：`journalctl --user -u pi-ai-daily -n 50 --since "today"` — 看 09:30 那次运行结果
2. 看仓库根目录 `~/cron-jobs/ai-daily/latest-news.json` 的 `date` 字段是不是今天 (`date -I`)
3. 看 gh-pages 远端最新 commit：`cd ~/cron-jobs/ai-daily && git log origin/gh-pages -1 --format=%s`，应该是 `📰 AI日报更新 YYYY-MM-DD`（今天日期）

三个条件齐了，算成功。

## 三种分支

### A. 成功（三个条件都满足）

读 `latest-news.json` 拿 articles 数量 N，然后用 Telegram bot 给家庭群发：

```bash
TOKEN=$(jq -r .botToken ~/.pi/agent/telegram.json)
curl -sS -X POST "https://api.telegram.org/bot$TOKEN/sendMessage" \
  -d "chat_id=-5242151700" \
  --data-urlencode "text=早安爸爸妈妈 ☀️
今天的 AI 日报小豹包🍞已经准备好啦：
https://shujie-xu.github.io/ai-daily/
今天精选了 ${N} 条。祝你们今天工作顺利～"
```

### B. 失败但可能临时（日报跑挂了 / latest-news 不是今天 / gh-pages 没今天的 commit）

1. 从 journal 找错误关键词（quota / 429 / timeout / fetch / merge / push）判断原因
2. 如果是临时问题（API quota / 网络 / 源站点 5xx），重新触发：
   ```bash
   systemctl --user start pi-ai-daily.service
   ```
3. 等 8 分钟（`sleep 480`，oneshot 一般 5-7 分钟跑完），再查一次 3 个条件
4. 如果这次成功了 → 走 **A**
5. 如果还是失败 → 走 **C**

### C. 解决不了（重跑后还是失败 / 错误是结构性的）

给家庭群发**人话**版的失败通知，别用太技术的措辞：

```bash
TOKEN=$(jq -r .botToken ~/.pi/agent/telegram.json)
# REASON 替换成你的简要判断，不超过 30 字
REASON="某个数据源连不上"  # 或 "今天 API 配额用完了"、"渲染步骤出错"等
curl -sS -X POST "https://api.telegram.org/bot$TOKEN/sendMessage" \
  -d "chat_id=-5242151700" \
  --data-urlencode "text=早安爸爸妈妈 ☀️
今天 AI 日报生成出了点问题（${REASON}），
小豹包稍后会再试。先附上昨天的备用链接：
https://shujie-xu.github.io/ai-daily/"
```

## 完成后报告

把这次检查结果（A/B/C，发了什么消息）记录在你的回复里，方便后续回溯。

## 注意

- 不要 spam 家庭群，整个流程**只发 1 条消息**
- 如果你发现自己卡在某个判断（比如不确定 latest-news 算不算今天的），优先选保守路径（不发消息或走 C 友好版）
- 重跑只允许一次，不要无限循环
