# AI Daily

## Discovery layers

Current v1 discovery flow is intentionally split into layers so we stop missing low-consensus or weak-signal events:

1. Broad search via `search-keywords.json`
2. Weak-signal discovery via `weak-signal-sources.json`
3. Generated targeted follow-up queries from `build_weak_signal_queries.js`
4. Event-level merge and dedup inside the daily cron flow

### New focus areas

- AI model and product launches
- Funding, M&A, strategic investment, acquisition rumors
- Policy and identity-verification / real-name changes
- Embodied intelligence: robotics software, robot brains, world models, VLA, simulation, control, humanoid deployments

### Helper command

```bash
node build_weak_signal_queries.js
```

This writes `weak-signal-queries.generated.json`, which the cron flow can use as a second-pass targeted-search queue after broad discovery.
