# arbitrage tracker

A live crypto market inefficiency detector. It pulls bid/ask prices from Binance, Kraken, and Coinbase, normalizes symbols, calculates cross-exchange spreads after trading fees, and streams ranked opportunities to a React dashboard.

## architecture

```text
exchanges -> price fetcher -> normalizer -> arbitrage engine -> websocket ui / alerts
```

The backend polls public REST endpoints every few seconds, then publishes a `MarketSnapshot` over `/live`. The frontend renders the newest snapshot without page refreshes.

## quick start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Optional Discord alerting:

```bash
cp .env.example .env
# set DISCORD_WEBHOOK_URL in .env
npm run dev
```

## what it measures

The arbitrage engine uses executable sides of the book:

- buy at the ask
- sell at the bid
- subtract maker/taker-style fee assumptions per exchange

That avoids the common mistake of comparing last traded prices and calling the difference profit.

## supported markets

- BTC/USD
- ETH/USD
- SOL/USD

Binance is fetched through stablecoin pairs and normalized into USD-style display for comparison. Treat those results as an approximation unless you explicitly model stablecoin conversion and venue-specific settlement.

## real-world constraints

This is a monitoring tool, not an execution engine.

- Transfer delays can erase a spread before funds arrive.
- Trading, withdrawal, and network fees often remove apparent profit.
- KYC limits and account tiers can block position movement.
- Slippage can turn a small spread negative during execution.
- Exchange outages, rate limits, and regional API restrictions affect data quality.
- Stablecoin quotes are not identical to fiat USD quotes during stress.

## scripts

- `npm run dev` starts the API and Vite UI together.
- `npm run build` type-checks and builds the frontend.
- `npm run lint` runs ESLint.
