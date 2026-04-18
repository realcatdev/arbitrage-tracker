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

## configuration

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
