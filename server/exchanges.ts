import { config } from "./config.js";
import type {
  AssetSymbol,
  CustomEndpointTestResult,
  CustomQuoteEndpoint,
  ExchangeCheck,
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

interface FetchSource {
  exchange: ExchangeId;
  fetchQuotes: () => Promise<FetchResult>;
}

interface MarketFetchResult {
  quote: Quote | null;
  error: string | null;
  check: ExchangeCheck;
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
  message: "waiting for first fetch",
  successCount: 0,
  failureCount: 0,
  checks: []
});

const failedResult = (exchange: ExchangeId, error: unknown): FetchResult => ({
  quotes: [],
  status: {
    ...baseStatus(exchange),
    message: error instanceof Error ? error.message : "unknown fetch error",
    failureCount: 1,
    checks: [
      {
        symbol: "all",
        sourceSymbol: exchange,
        ok: false,
        message: error instanceof Error ? error.message : "unknown fetch error",
        code: errorCode(error)
      }
    ]
  }
});

export const statusForQuotes = (
  exchange: ExchangeId,
  quotes: Quote[],
  failureCount: number,
  label: string,
  checks: ExchangeCheck[] = []
): ExchangeStatus => {
  if (quotes.length > 0 && failureCount > 0) {
    return {
      exchange,
      ok: true,
      lastUpdate: Date.now(),
      message: `${quotes.length} ${label} online, ${failureCount} failed`,
      successCount: quotes.length,
      failureCount,
      checks
    };
  }

  if (quotes.length > 0) {
    return {
      exchange,
      ok: true,
      lastUpdate: Date.now(),
      message: `${quotes.length} ${label} online`,
      successCount: quotes.length,
      failureCount,
      checks
    };
  }

  return {
    ...baseStatus(exchange),
    message: `0 ${label} online${failureCount > 0 ? `, ${failureCount} failed` : ""}`,
    failureCount,
    checks
  };
};

const settledMarketResults = (
  results: PromiseSettledResult<MarketFetchResult>[]
): MarketFetchResult[] =>
  results.map((result) =>
    result.status === "fulfilled"
      ? result.value
      : {
          quote: null,
          error: result.reason instanceof Error ? result.reason.message : "unknown market error",
          check: {
            symbol: "unknown",
            sourceSymbol: "unknown",
            ok: false,
            message: result.reason instanceof Error ? result.reason.message : "unknown market error",
            code: errorCode(result.reason)
          }
        }
  );

const errorCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error)) {
    return undefined;
  }

  return error.message.match(/\b\d{3}\b/)?.[0] ?? error.name;
};

const successCheck = (
  symbol: string,
  sourceSymbol: string,
  quoteSource: string,
  startedAt: number
): ExchangeCheck => ({
  symbol,
  sourceSymbol,
  ok: true,
  message: "quote accepted",
  quoteSource,
  latencyMs: Date.now() - startedAt
});

const failureCheck = (
  symbol: string,
  sourceSymbol: string,
  error: unknown,
  startedAt: number
): ExchangeCheck => ({
  symbol,
  sourceSymbol,
  ok: false,
  message: error instanceof Error ? error.message : "unknown quote error",
  code: errorCode(error),
  latencyMs: Date.now() - startedAt
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
  const results = await Promise.allSettled(
    getMarkets().map(async (market): Promise<MarketFetchResult> => {
      const startedAt = Date.now();
      try {
        let sourceHost = "api.binance.com";
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

        const quoteSource = `${market.binance} stablecoin quote via ${sourceHost}`;
        const quote = {
            exchange,
            symbol: market.symbol,
            bid,
            ask,
            feeRate: feeFor(exchange),
            quoteSource,
            timestamp: Date.now()
          };

        return {
          quote,
          error: null,
          check: successCheck(market.symbol, market.binance, quoteSource, startedAt)
        };
      } catch (error) {
        return {
          quote: null,
          error: error instanceof Error ? error.message : `unknown binance error for ${market.symbol}`,
          check: failureCheck(market.symbol, market.binance, error, startedAt)
        };
      }
    })
  );
  const marketResults = settledMarketResults(results);
  const quotes = marketResults.flatMap((result) => (result.quote ? [result.quote] : []));
  const failureCount = marketResults.filter((result) => result.error !== null).length;

  return {
    quotes,
    status: statusForQuotes(
      exchange,
      quotes,
      failureCount,
      "markets",
      marketResults.map((result) => result.check)
    )
  };
};

export const fetchKrakenQuotes = async (): Promise<FetchResult> => {
  const exchange: ExchangeId = "kraken";
  const results = await Promise.allSettled(
    getMarkets().map(async (market): Promise<MarketFetchResult> => {
      const startedAt = Date.now();
      try {
        const data = await requestJson<{
          error: string[];
          result?: Record<string, { b: [string]; a: [string] }>;
        }>(`https://api.kraken.com/0/public/Ticker?pair=${market.kraken}`);

        if (data.error.length > 0) {
          throw new Error(data.error.join(", "));
        }

        const availableEntries = Object.entries(data.result ?? {});
        const expectedKeys = new Set(krakenResultKeys(market));
        const ticker = availableEntries.find(([key]) =>
          Array.from(expectedKeys).some((expected) => normalizeKey(key).includes(expected))
        )?.[1];
        const bid = numberFrom(ticker?.b?.[0]);
        const ask = numberFrom(ticker?.a?.[0]);

        if (bid === null || ask === null) {
          throw new Error(`invalid kraken ticker for ${market.kraken}`);
        }

        const quote = {
            exchange,
            symbol: market.symbol,
            bid,
            ask,
            feeRate: feeFor(exchange),
            quoteSource: market.kraken,
            timestamp: Date.now()
          };

        return {
          quote,
          error: null,
          check: successCheck(market.symbol, market.kraken, market.kraken, startedAt)
        };
      } catch (error) {
        return {
          quote: null,
          error: error instanceof Error ? error.message : `unknown kraken error for ${market.symbol}`,
          check: failureCheck(market.symbol, market.kraken, error, startedAt)
        };
      }
    })
  );
  const marketResults = settledMarketResults(results);
  const quotes = marketResults.flatMap((result) => (result.quote ? [result.quote] : []));
  const failureCount = marketResults.filter((result) => result.error !== null).length;

  return {
    quotes,
    status: statusForQuotes(
      exchange,
      quotes,
      failureCount,
      "markets",
      marketResults.map((result) => result.check)
    )
  };
};

export const fetchCoinbaseQuotes = async (): Promise<FetchResult> => {
  const exchange: ExchangeId = "coinbase";
  const results = await Promise.allSettled(
    getMarkets().map(async (market): Promise<MarketFetchResult> => {
      const startedAt = Date.now();
      try {
        const data = await requestJson<{ bids: [string, string][]; asks: [string, string][] }>(
          `https://api.exchange.coinbase.com/products/${market.coinbase}/book?level=1`
        );
        const bid = numberFrom(data.bids?.[0]?.[0]);
        const ask = numberFrom(data.asks?.[0]?.[0]);

        if (bid === null || ask === null) {
          throw new Error(`invalid coinbase book for ${market.coinbase}`);
        }

        const quote = {
            exchange,
            symbol: market.symbol,
            bid,
            ask,
            feeRate: feeFor(exchange),
            quoteSource: market.coinbase,
            timestamp: Date.now()
          };

        return {
          quote,
          error: null,
          check: successCheck(market.symbol, market.coinbase, market.coinbase, startedAt)
        };
      } catch (error) {
        return {
          quote: null,
          error: error instanceof Error ? error.message : `unknown coinbase error for ${market.symbol}`,
          check: failureCheck(market.symbol, market.coinbase, error, startedAt)
        };
      }
    })
  );
  const marketResults = settledMarketResults(results);
  const quotes = marketResults.flatMap((result) => (result.quote ? [result.quote] : []));
  const failureCount = marketResults.filter((result) => result.error !== null).length;

  return {
    quotes,
    status: statusForQuotes(
      exchange,
      quotes,
      failureCount,
      "markets",
      marketResults.map((result) => result.check)
    )
  };
};

export const fetchCustomEndpointQuotes = async (
  exchange: ExchangeId,
  url: string,
  headers: Record<string, string> = {}
): Promise<FetchResult> => {
  const quotes: Quote[] = [];
  const checks: ExchangeCheck[] = [];
  const startedAt = Date.now();

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
        checks.push({
          symbol: symbol || "unknown",
          sourceSymbol: url,
          ok: false,
          message: "custom quote missing valid symbol, bid, or ask",
          code: "invalid_payload",
          latencyMs: Date.now() - startedAt
        });
        continue;
      }

      const quoteSource = payload.quoteSource ?? url;
      quotes.push({
        exchange: payload.exchange?.trim().toLowerCase() || exchange,
        symbol,
        bid,
        ask,
        feeRate: nonNegativeNumberFrom(payload.feeRate) ?? feeFor(exchange),
        quoteSource,
        timestamp: payload.timestamp ?? Date.now()
      });
      checks.push(successCheck(symbol, url, quoteSource, startedAt));
    }

    return {
      quotes,
      status: statusForQuotes(
        exchange,
        quotes,
        payloads.length - quotes.length,
        "custom quotes",
        checks
      )
    };
  } catch (error) {
    return {
      quotes,
      status: {
        ...baseStatus(exchange),
        message: error instanceof Error ? error.message : "unknown custom endpoint error",
        failureCount: 1,
        checks: [failureCheck(exchange, url, error, startedAt)]
      }
    };
  }
};

export const fetchAllQuotes = async (): Promise<FetchResult[]> => {
  const sources: FetchSource[] = [
    { exchange: "binance", fetchQuotes: fetchBinanceQuotes },
    { exchange: "kraken", fetchQuotes: fetchKrakenQuotes },
    { exchange: "coinbase", fetchQuotes: fetchCoinbaseQuotes },
    ...config.customQuoteEndpoints.map((endpoint) => ({
      exchange: endpoint.name,
      fetchQuotes: () =>
        fetchCustomEndpointQuotes(endpoint.name, endpoint.url, endpoint.headers ?? {})
    }))
  ];

  const settled = await Promise.allSettled(sources.map((source) => source.fetchQuotes()));

  return settled.map((result, index) =>
    result.status === "fulfilled" ? result.value : failedResult(sources[index].exchange, result.reason)
  );
};

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
