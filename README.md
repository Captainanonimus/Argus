# Argus

Real-time market-manipulation surveillance. Argus watches live order flow, flags quote stuffing, spoofing and order-book imbalance with transparent statistical rules, and sends only the genuinely ambiguous cases to two AI models for a second opinion.

**Live app: https://argus-lilac-theta.vercel.app**

Built by Team Nexus Knights (KCC Institute of Technology and Management, Greater Noida) for Build with Bharat 4.0 (CodeVerse).

## What it does

- **Quant rules first.** Order-to-trade ratio above 15:1 (quote stuffing), large orders cancelled within 2 seconds against an adverse price move (spoofing), and order-book imbalance z-score bands (above 3 flags, 1.5 to 3 goes to AI review).
- **Dual-brain AI on gray-zone cases only.** Two free open models answer independently through OpenRouter, a third steps in as fallback, and disagreement is routed to human review.
- **Live terminal.** Candlestick chart with alert markers, order-book depth, time and sales, and a live alert blotter.
- **Case management.** Filter alerts, work them through open, investigating, escalated and dismissed, add notes, export CSV, print a case report.
- **Simulator and CSV import.** Run quote-stuffing, spoofing and imbalance scenarios in one click, or import your own order events.
- **Assistant.** Ask questions about your alerts. With a TinyFish key, it also searches and reads the live web and cites sources.

## Stack

Next.js 14 (App Router), TypeScript, Tailwind CSS, Prisma, PostgreSQL (Neon), deployed on Vercel. Charts by TradingView Lightweight Charts. AI via OpenRouter free models. Web research via TinyFish.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | PostgreSQL connection strings |
| `OPENROUTER_API_KEY` | OpenRouter key (or paste one in Settings) |
| `AI_PRIMARY_MODEL`, `AI_SECONDARY_MODEL`, `AI_LAST_RESORT_MODEL` | Model ids for the dual-brain check |
| `AI_TIMEOUT_MS` | Per-model timeout in milliseconds |
| `TINYFISH_API_KEY` | Optional default key (users can paste their own in Settings) |
| `ALLOW_DB_WRITES_HOST` | Required by `npm run record`, `replay` and `backtest`: must be a substring of the `DATABASE_URL` host, otherwise the script prints the host and exits with code 1 |

`record`, `replay` and `backtest` write to the database, so they refuse to run against a host you have not explicitly allowed. For example, with `DATABASE_URL=postgres://user:pw@ep-quiet-lake-123456.us-east-2.aws.neon.tech/argus`, set `ALLOW_DB_WRITES_HOST=ep-quiet-lake-123456`.

## Run locally

```bash
npm install
npx prisma db push
npm run dev
```

Argus produces statistical signals for human review. It is not legal advice and does not accuse anyone of misconduct.
