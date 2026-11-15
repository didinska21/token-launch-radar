# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/didinska21/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/didinska21/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for token launches that have not happened yet. From one sealed DefiLlama snapshot it ranks 158 protocols that record no token of their own — the house watchlist of 40 plus 118 early finds below its $50M floor — by an implied value learned from the snapshot itself: each category's multiple is the median market-cap/TVL of that category's already-listed protocols, then adjusted for 7-day TVL momentum, time tracked with no token, and chain breadth. Wrapped, staked or bridged products of tokens that already trade, and exchange balance sheets, are never ranked. Every row carries a five-step farm plan with costs and times, and the static dashboard is sortable, filterable, and gives each protocol a detail view with its full factor breakdown.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=hvvp36vk&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
