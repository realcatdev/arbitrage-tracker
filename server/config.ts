import "dotenv/config";
import type { RuntimeConfig } from "../shared/types.js";

const defaultMarkets = ["BTC/USD", "ETH/USD", "SOL/USD"];
const defaultFees: Record<string, number> = {
  binance: 0.001,
  kraken: 0.0026,
  coinbase: 0.006
};

const parseNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const normalizeMarkets = (value: unknown): string[] => {
  const rawMarkets = Array.isArray(value)
    ? value
    : String(value ?? defaultMarkets.join(",")).split(",");
  const markets = rawMarkets
    .map((symbol) => String(symbol).trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol));

  return Array.from(new Set(markets)).slice(0, 24);
};

const parseMarkets = (value: string | undefined): string[] =>
  normalizeMarkets(value ?? defaultMarkets.join(","));

const normalizeExchangeFees = (value: unknown): Record<string, number> => {
  const fees: Record<string, number> = {};
  const entries =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.entries(value)
      : Object.entries(defaultFees);

  for (const [exchange, rawFee] of entries) {
    const fee = Number(rawFee);

    if (exchange && Number.isFinite(fee) && fee >= 0) {
      fees[exchange.trim().toLowerCase()] = fee;
    }
  }

  return fees;
};

const parseExchangeFees = (value: string | undefined): Record<string, number> => {
  const fees = { ...defaultFees };

  for (const pair of value?.split(",") ?? []) {
    const [exchange, rawFee] = pair.split(":").map((part) => part.trim());
    const fee = Number(rawFee);

    if (exchange && Number.isFinite(fee) && fee >= 0) {
      fees[exchange.toLowerCase()] = fee;
    }
  }

  return fees;
};

const normalizeCustomEndpoints = (value: unknown): Array<{ name: string; url: string }> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((endpoint) => {
      if (!endpoint || typeof endpoint !== "object") {
        return null;
      }

      const source = endpoint as Record<string, unknown>;
      const name = String(source.name ?? "")
        .trim()
        .toLowerCase();
      const url = String(source.url ?? "").trim();

      return name && url ? { name, url } : null;
    })
    .filter((endpoint): endpoint is { name: string; url: string } => endpoint !== null)
    .slice(0, 12);
};

const parseCustomEndpoints = (value: string | undefined): Array<{ name: string; url: string }> =>
  (value ?? "")
    .split(",")
    .map((entry) => {
      const separator = entry.indexOf(":");

      if (separator < 1) {
        return null;
      }

      const name = entry.slice(0, separator).trim().toLowerCase();
      const url = entry.slice(separator + 1).trim();

      return name && url ? { name, url } : null;
    })
    .filter((endpoint): endpoint is { name: string; url: string } => endpoint !== null);

export const config: RuntimeConfig & { port: number } = {
  port: Number(process.env.PORT ?? 4000),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 3000),
  alertThresholdPercent: Number(process.env.ALERT_THRESHOLD_PERCENT ?? 0.25),
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim() || null,
  trackedMarkets: parseMarkets(process.env.TRACKED_MARKETS),
  exchangeFees: parseExchangeFees(process.env.EXCHANGE_FEES),
  customQuoteEndpoints: parseCustomEndpoints(process.env.CUSTOM_QUOTE_ENDPOINTS)
};

export const publicConfig = (): RuntimeConfig => ({
  pollIntervalMs: config.pollIntervalMs,
  alertThresholdPercent: config.alertThresholdPercent,
  discordWebhookUrl: config.discordWebhookUrl,
  trackedMarkets: [...config.trackedMarkets],
  exchangeFees: { ...config.exchangeFees },
  customQuoteEndpoints: config.customQuoteEndpoints.map((endpoint) => ({ ...endpoint }))
});

export const updateConfig = (input: Partial<RuntimeConfig>): RuntimeConfig => {
  if ("pollIntervalMs" in input) {
    config.pollIntervalMs = Math.max(1000, parseNumber(input.pollIntervalMs, config.pollIntervalMs));
  }

  if ("alertThresholdPercent" in input) {
    config.alertThresholdPercent = parseNumber(
      input.alertThresholdPercent,
      config.alertThresholdPercent
    );
  }

  if ("discordWebhookUrl" in input) {
    const value = input.discordWebhookUrl?.trim();
    config.discordWebhookUrl = value || null;
  }

  if ("trackedMarkets" in input) {
    const markets = normalizeMarkets(input.trackedMarkets);
    config.trackedMarkets = markets.length > 0 ? markets : [...defaultMarkets];
  }

  if ("exchangeFees" in input) {
    config.exchangeFees = {
      ...defaultFees,
      ...normalizeExchangeFees(input.exchangeFees)
    };
  }

  if ("customQuoteEndpoints" in input) {
    config.customQuoteEndpoints = normalizeCustomEndpoints(input.customQuoteEndpoints);
  }

  return publicConfig();
};
