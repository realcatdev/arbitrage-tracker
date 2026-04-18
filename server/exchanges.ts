import { config } from "./config.js";
import type {
  AssetSymbol,
  CustomEndpointTestResult,
  CustomQuoteEndpoint,
  ExchangeId,
  ExchangeStatus,
  Quote
} from "../shared/types.js";

interface MarketConfig {
  symbol: AssetSymbol;
  base: string;
  quote: string;
  binance: string;
  kraken: string;
  coinbase: string;
}

interface FetchResult {
  quotes: Quote[];
  status: ExchangeStatus;
}

interface CustomQuotePayload {
  exchange?: string;
  symbol: string;
  bid: number | string;
  ask: number | string;
  feeRate?: number | string;
  quoteSource?: string;
  timestamp?: number;
}

const krakenBaseAliases: Record<string, string> = {
  BTC: "XBT"
};

const krakenResultKeys = (market: MarketConfig): string[] => {
  const krakenBase = krakenBaseAliases[market.base] ?? market.base;
  const candidates = [
    market.kraken,
    `${market.base}${market.quote}`,
    `${krakenBase}${market.quote}`
  ];

  if (market.quote === "USD") {
    candidates.push(`X${krakenBase}ZUSD`, `X${market.base}ZUSD`);
  }

  return candidates.map(normalizeKey);
};

const getMarkets = (): MarketConfig[] =>
  config.trackedMarkets.map((symbol) => {
    const [base, quote] = symbol.split("/");
    const binanceQuote = quote === "USD" ? "USDT" : quote;

    return {
      symbol,
      base,
      quote,
      binance: `${base}${binanceQuote}`,
      kraken: `${krakenBaseAliases[base] ?? base}${quote}`,
      coinbase: `${base}-${quote}`
    };
  });

const feeFor = (exchange: ExchangeId): number => config.exchangeFees[exchange] ?? 0.0025;

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

const nonNegativeNumberFrom = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const normalizeKey = (value: string): string => value.replace(/[^A-Z0-9]/gi, "").toUpperCase();

const requestJson = async <T>(
  url: string,
  timeoutMs = 5000,
  headers: Record<string, string> = {}
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "arbitrage-tracker/0.1",
        ...headers
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
      getMarkets().map(async (market) => {
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
          feeRate: feeFor(exchange),
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
  const markets = getMarkets();

  try {
    const pairs = markets.map((market) => market.kraken).join(",");
    const data = await requestJson<{
      error: string[];
      result: Record<string, { b: [string]; a: [string] }>;
    }>(`https://api.kraken.com/0/public/Ticker?pair=${pairs}`);

    if (data.error.length > 0) {
      throw new Error(data.error.join(", "));
    }

    const availableEntries = Object.entries(data.result);

    for (const market of markets) {
      const expectedKeys = new Set(krakenResultKeys(market));
      const ticker = availableEntries.find(([key]) =>
        Array.from(expectedKeys).some((expected) => normalizeKey(key).includes(expected))
      )?.[1];
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
        feeRate: feeFor(exchange),
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
      getMarkets().map(async (market) => {
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
          feeRate: feeFor(exchange),
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

export const fetchCustomEndpointQuotes = async (
  exchange: ExchangeId,
  url: string,
  headers: Record<string, string> = {}
): Promise<FetchResult> => {
  const quotes: Quote[] = [];

  try {
    const data = await requestJson<CustomQuotePayload[] | { quotes: CustomQuotePayload[] }>(
      url,
      5000,
      headers
    );
    const payloads = Array.isArray(data) ? data : data.quotes;

    if (!Array.isArray(payloads)) {
      throw new Error("custom endpoint must return an array or { quotes: [] }");
    }

    for (const payload of payloads) {
      const symbol = payload.symbol?.trim().toUpperCase();
      const bid = numberFrom(payload.bid);
      const ask = numberFrom(payload.ask);

      if (!symbol || bid === null || ask === null) {
        continue;
      }

      quotes.push({
        exchange: payload.exchange?.trim().toLowerCase() || exchange,
        symbol,
        bid,
        ask,
        feeRate: nonNegativeNumberFrom(payload.feeRate) ?? feeFor(exchange),
        quoteSource: payload.quoteSource ?? url,
        timestamp: payload.timestamp ?? Date.now()
      });
    }

    return {
      quotes,
      status: {
        exchange,
        ok: true,
        lastUpdate: Date.now(),
        message: `${quotes.length} custom quotes online`
      }
    };
  } catch (error) {
    return {
      quotes,
      status: {
        ...baseStatus(exchange),
        message: error instanceof Error ? error.message : "unknown custom endpoint error"
      }
    };
  }
};

export const fetchAllQuotes = async (): Promise<FetchResult[]> =>
  Promise.all([
    fetchBinanceQuotes(),
    fetchKrakenQuotes(),
    fetchCoinbaseQuotes(),
    ...config.customQuoteEndpoints.map((endpoint) =>
      fetchCustomEndpointQuotes(endpoint.name, endpoint.url, endpoint.headers ?? {})
    )
  ]);

export const testCustomEndpoint = async (
  endpoint: CustomQuoteEndpoint
): Promise<CustomEndpointTestResult> => {
  const result = await fetchCustomEndpointQuotes(endpoint.name, endpoint.url, endpoint.headers);

  return {
    ok: result.status.ok && result.quotes.length > 0,
    message: result.status.message,
    quoteCount: result.quotes.length
  };
};
