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

## start and stop

Start the full app:

```bash
cd /Users/sonnet/Documents/Codex/arbitrage-tracker
npm run dev
```

Open the dashboard:

```text
http://localhost:5173/
```

The backend API runs at:

```text
http://localhost:4000/
```

Check that the backend is healthy:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/config
```

Stop the app from the terminal where it is running:

```text
ctrl + c
```

If dependencies are missing or the install cache has permission issues:

```bash
npm install --cache .npm-cache
```

## configuration

Most runtime settings can be changed in the dashboard under **Developer settings**. The GUI can update tracked markets, polling interval, alert threshold, fee assumptions, Discord webhook URL, and custom quote API endpoints without restarting the app. Saved GUI settings persist to `data/runtime-config.json`, which is intentionally ignored by git.

Use the market composer to add any `BASE/QUOTE` pair, such as `DOGE/USD`, `BTC/EUR`, or `PEPE/USDT`. Built-in exchanges will only return pairs they support, but custom quote APIs can provide any matching symbol.

The default markets are `BTC/USD`, `ETH/USD`, and `SOL/USD`, but the backend can track a different comma-separated set:

```bash
TRACKED_MARKETS=BTC/USD,ETH/USD,DOGE/USD,LTC/USD
```

The built-in adapters derive exchange pair ids from those symbols:

- Binance uses `USD` markets as stablecoin quotes such as `BTCUSDT`.
- Kraken uses common pair ids such as `XBTUSD`, `ETHUSD`, and `SOLUSD`.
- Coinbase uses product ids such as `BTC-USD`.

Some assets will not be available on every exchange. The exchange health panel will show partial failures or a lower market count when an adapter cannot fetch a symbol.

Basic fee assumptions can be overridden without code changes:

```bash
EXCHANGE_FEES=binance:0.001,kraken:0.0026,coinbase:0.006,mydesk:0.0015
```

## custom quote apis

Users can add their own public or private quote source if they expose normalized bid/ask data over HTTP:

```bash
CUSTOM_QUOTE_ENDPOINTS=mydesk:http://localhost:9000/quotes
```

The endpoint can return an array:

```json
[
  {
    "symbol": "BTC/USD",
    "bid": 65000,
    "ask": 65010,
    "feeRate": 0.0015
  }
]
```

Or an object with a `quotes` array:

```json
{
  "quotes": [
    {
      "symbol": "ETH/USD",
      "bid": 3200,
      "ask": 3201,
      "quoteSource": "internal desk feed"
    }
  ]
}
```

Custom quotes are compared against built-in exchanges automatically when their `symbol` matches.

In the GUI, each custom API row also supports optional request headers, one per line:

```text
Authorization: Bearer your-token
X-API-Key: your-key
```

Use the row's `test` button to verify that the endpoint responds with usable quotes before saving. Header values are stored in the local runtime config file, so do not expose this dashboard publicly with real API keys loaded.

If a custom API token or header is invalid, that feed is marked unhealthy and the rest of the tracker keeps running. Built-in exchanges and other custom feeds continue to update.

## what it measures

The arbitrage engine uses executable sides of the book:

- buy at the ask
- sell at the bid
- subtract maker/taker-style fee assumptions per exchange

That avoids the common mistake of comparing last traded prices and calling the difference profit.

## default markets

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
