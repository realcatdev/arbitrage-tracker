import type { AssetSymbol, ExchangeId, ExchangeStatus, Quote } from "../shared/types.js";

interface MarketConfig {
  symbol: AssetSymbol;
  binance: string;
  kraken: string;
  krakenResultKey: string;
  coinbase: string;
}

interface FetchResult {
  quotes: Quote[];
  status: ExchangeStatus;
}

const markets: MarketConfig[] = [
  {
    symbol: "BTC/USD",
    binance: "BTCUSDT",
    kraken: "XBTUSD",
    krakenResultKey: "XXBTZUSD",
    coinbase: "BTC-USD"
  },
  {
    symbol: "ETH/USD",
    binance: "ETHUSDT",
    kraken: "ETHUSD",
    krakenResultKey: "XETHZUSD",
    coinbase: "ETH-USD"
  },
  {
    symbol: "SOL/USD",
    binance: "SOLUSDT",
    kraken: "SOLUSD",
    krakenResultKey: "SOLUSD",
    coinbase: "SOL-USD"
  }
];

const exchangeFees: Record<ExchangeId, number> = {
  binance: 0.001,
  kraken: 0.0026,
  coinbase: 0.006
};

const baseStatus = (exchange: ExchangeId): ExchangeStatus => ({
  exchange,
  ok: false,
  lastUpdate: null,
  message: "waiting for first fetch"
});

const numberFrom = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const requestJson = async <T>(url: string, timeoutMs = 5000): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "arbitrage-tracker/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchBinanceQuotes = async (): Promise<FetchResult> => {
  const exchange: ExchangeId = "binance";
  const quotes: Quote[] = [];
  let sourceHost = "api.binance.com";

  try {
    await Promise.all(
      markets.map(async (market) => {
        let data: { bidPrice: string; askPrice: string };

        try {
          data = await requestJson<{ bidPrice: string; askPrice: string }>(
            `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${market.binance}`
          );
        } catch {
          sourceHost = "api.binance.us";
          data = await requestJson<{ bidPrice: string; askPrice: string }>(
            `https://api.binance.us/api/v3/ticker/bookTicker?symbol=${market.binance}`
          );
        }

        const bid = numberFrom(data.bidPrice);
        const ask = numberFrom(data.askPrice);

        if (bid === null || ask === null) {
          throw new Error(`invalid book ticker for ${market.binance}`);
        }

        quotes.push({
          exchange,
          symbol: market.symbol,
          bid,
          ask,
          feeRate: exchangeFees[exchange],
          quoteSource: `${market.binance} stablecoin quote via ${sourceHost}`,
          timestamp: Date.now()
        });
      })
    );

    return {
      quotes,
      status: {
        exchange,
        ok: true,
        lastUpdate: Date.now(),
        message: `${quotes.length} markets online`
      }
    };
  } catch (error) {
    return {
      quotes,
      status: {
        ...baseStatus(exchange),
        message: error instanceof Error ? error.message : "unknown binance error"
      }
    };
  }
};

export const fetchKrakenQuotes = async (): Promise<FetchResult> => {
  const exchange: ExchangeId = "kraken";
  const quotes: Quote[] = [];

  try {
    const pairs = markets.map((market) => market.kraken).join(",");
    const data = await requestJson<{
      error: string[];
      result: Record<string, { b: [string]; a: [string] }>;
    }>(`https://api.kraken.com/0/public/Ticker?pair=${pairs}`);

    if (data.error.length > 0) {
      throw new Error(data.error.join(", "));
    }

    for (const market of markets) {
      const ticker = data.result[market.krakenResultKey];
      const bid = numberFrom(ticker?.b?.[0]);
      const ask = numberFrom(ticker?.a?.[0]);

      if (bid === null || ask === null) {
        continue;
      }

      quotes.push({
        exchange,
        symbol: market.symbol,
        bid,
        ask,
        feeRate: exchangeFees[exchange],
        quoteSource: market.kraken,
        timestamp: Date.now()
      });
    }

    if (quotes.length === 0) {
      throw new Error("no kraken markets returned usable bid/ask data");
    }

    return {
      quotes,
      status: {
        exchange,
        ok: true,
        lastUpdate: Date.now(),
        message: `${quotes.length} markets online`
      }
    };
  } catch (error) {
    return {
      quotes,
      status: {
        ...baseStatus(exchange),
        message: error instanceof Error ? error.message : "unknown kraken error"
      }
    };
  }
};

export const fetchCoinbaseQuotes = async (): Promise<FetchResult> => {
  const exchange: ExchangeId = "coinbase";
  const quotes: Quote[] = [];

  try {
    await Promise.all(
      markets.map(async (market) => {
        const data = await requestJson<{ bids: [string, string][]; asks: [string, string][] }>(
          `https://api.exchange.coinbase.com/products/${market.coinbase}/book?level=1`
        );
        const bid = numberFrom(data.bids?.[0]?.[0]);
        const ask = numberFrom(data.asks?.[0]?.[0]);

        if (bid === null || ask === null) {
          throw new Error(`invalid coinbase book for ${market.coinbase}`);
        }

        quotes.push({
          exchange,
          symbol: market.symbol,
          bid,
          ask,
          feeRate: exchangeFees[exchange],
          quoteSource: market.coinbase,
          timestamp: Date.now()
        });
      })
    );

    return {
      quotes,
      status: {
        exchange,
        ok: true,
        lastUpdate: Date.now(),
        message: `${quotes.length} markets online`
      }
    };
  } catch (error) {
    return {
      quotes,
      status: {
        ...baseStatus(exchange),
        message: error instanceof Error ? error.message : "unknown coinbase error"
      }
    };
  }
};

export const fetchAllQuotes = async (): Promise<FetchResult[]> =>
  Promise.all([fetchBinanceQuotes(), fetchKrakenQuotes(), fetchCoinbaseQuotes()]);
