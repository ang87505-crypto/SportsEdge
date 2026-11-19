# SportsEdge

A private research site: a daily **PrizePicks paper test** on NBA player props,
sports model research, and a stock strategy on an Alpaca **paper** account.
Everything uses virtual money; nothing places a real bet, entry or trade.

- Running it day to day (no AI needed): [`docs/OWNER_RUNBOOK.md`](docs/OWNER_RUNBOOK.md)
- How the props test works: [`docs/NBA_PLAYER_PROPS_PAPER_2026_11_07.md`](docs/NBA_PLAYER_PROPS_PAPER_2026_11_07.md)
- Running without AI subscriptions: [`docs/INDEPENDENT_PAPER_AUTOMATION_2026_11_07.md`](docs/INDEPENDENT_PAPER_AUTOMATION_2026_11_07.md)

## Local development

```bash
npm ci
```

```bash
npm run dev
```

Open http://localhost:3000. Without database settings the pages show "not
connected" instead of example numbers.

Built with Next.js, hosted on Vercel, records in Supabase, jobs on GitHub Actions.
