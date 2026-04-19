import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CustomQuoteEndpoint, RuntimeConfig } from "../shared/types.js";

const defaultMarkets = ["BTC/USD", "ETH/USD", "SOL/USD"];
const defaultEnabledExchanges = ["binance", "kraken", "coinbase"];
const defaultFees: Record<string, number> = {
  binance: 0.001,
  kraken: 0.0026,
  coinbase: 0.006
};
const runtimeConfigPath = resolve(process.cwd(), "data/runtime-config.json");

const parseNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const normalizeExchangeId = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeExchangeIds = (value: unknown, fallback: string[] = []): string[] => {
  const rawExchanges = Array.isArray(value)
    ? value
    : String(value ?? fallback.join(",")).split(",");
  const exchanges = rawExchanges.map(normalizeExchangeId).filter(Boolean);

  return Array.from(new Set(exchanges)).slice(0, 32);
};

const normalizeMarkets = (value: unknown): string[] => {
  const rawMarkets = Array.isArray(value)
    ? value
    : String(value ?? defaultMarkets.join(",")).split(",");
  const markets = rawMarkets
    .map((symbol) => String(symbol).trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol));

  return Array.from(new Set(markets)).slice(0, 48);
};

const parseMarkets = (value: string | undefined): string[] =>
  normalizeMarkets(value ?? defaultMarkets.join(","));

const parseEnabledExchanges = (value: string | undefined, customExchanges: string[]): string[] =>
  normalizeExchangeIds(value, [...defaultEnabledExchanges, ...customExchanges]);

const normalizeHeaders = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, rawValue]) => [key.trim(), String(rawValue).trim()])
      .filter(([key, rawValue]) => key && rawValue)
  );
};

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

const normalizeCustomEndpoints = (value: unknown): CustomQuoteEndpoint[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((endpoint) => {
      if (!endpoint || typeof endpoint !== "object") {
        return null;
      }

      const source = endpoint as Record<string, unknown>;
      const name = normalizeExchangeId(source.name);
      const url = String(source.url ?? "").trim();
      const headers = normalizeHeaders(source.headers);

      return name && url
        ? {
            name,
            url,
            ...(Object.keys(headers).length > 0 ? { headers } : {})
          }
        : null;
    })
    .filter((endpoint): endpoint is CustomQuoteEndpoint => endpoint !== null)
    .slice(0, 24);
};

const parseCustomEndpoints = (value: string | undefined): CustomQuoteEndpoint[] =>
  (value ?? "")
    .split(",")
    .map((entry) => {
      const separator = entry.indexOf(":");

      if (separator < 1) {
        return null;
      }

      const name = normalizeExchangeId(entry.slice(0, separator));
      const url = entry.slice(separator + 1).trim();

      return name && url ? { name, url } : null;
    })
    .filter((endpoint): endpoint is CustomQuoteEndpoint => endpoint !== null);

const envRuntimeConfig = (): RuntimeConfig => {
  const customQuoteEndpoints = parseCustomEndpoints(process.env.CUSTOM_QUOTE_ENDPOINTS);

  return {
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 3000),
    alertThresholdPercent: Number(process.env.ALERT_THRESHOLD_PERCENT ?? 0.25),
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim() || null,
    trackedMarkets: parseMarkets(process.env.TRACKED_MARKETS),
    enabledExchanges: parseEnabledExchanges(
      process.env.ENABLED_EXCHANGES,
      customQuoteEndpoints.map((endpoint) => endpoint.name)
    ),
    exchangeFees: parseExchangeFees(process.env.EXCHANGE_FEES),
    customQuoteEndpoints
  };
};

const readPersistedConfig = (): Partial<RuntimeConfig> => {
  if (!existsSync(runtimeConfigPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(runtimeConfigPath, "utf8")) as Partial<RuntimeConfig>;
  } catch {
    return {};
  }
};

const applyConfigPatch = (base: RuntimeConfig, input: Partial<RuntimeConfig>): RuntimeConfig => {
  const trackedMarkets =
    "trackedMarkets" in input
      ? normalizeMarkets(input.trackedMarkets).length > 0
        ? normalizeMarkets(input.trackedMarkets)
        : [...defaultMarkets]
      : [...base.trackedMarkets];
  const customQuoteEndpoints =
    "customQuoteEndpoints" in input
      ? normalizeCustomEndpoints(input.customQuoteEndpoints)
      : base.customQuoteEndpoints.map((endpoint) => ({ ...endpoint }));
  const customExchangeIds = customQuoteEndpoints.map((endpoint) => endpoint.name);
  const enabledExchanges =
    "enabledExchanges" in input
      ? normalizeExchangeIds(input.enabledExchanges)
      : normalizeExchangeIds(base.enabledExchanges, [
          ...defaultEnabledExchanges,
          ...customExchangeIds
        ]);

  return {
    pollIntervalMs:
      "pollIntervalMs" in input
        ? Math.max(1000, parseNumber(input.pollIntervalMs, base.pollIntervalMs))
        : base.pollIntervalMs,
    alertThresholdPercent:
      "alertThresholdPercent" in input
        ? parseNumber(input.alertThresholdPercent, base.alertThresholdPercent)
        : base.alertThresholdPercent,
    discordWebhookUrl:
      "discordWebhookUrl" in input ? input.discordWebhookUrl?.trim() || null : base.discordWebhookUrl,
    trackedMarkets,
    enabledExchanges,
    exchangeFees:
      "exchangeFees" in input
        ? {
            ...defaultFees,
            ...normalizeExchangeFees(input.exchangeFees)
          }
        : { ...base.exchangeFees },
    customQuoteEndpoints
  };
};

const persistConfig = (runtimeConfig: RuntimeConfig): void => {
  mkdirSync(dirname(runtimeConfigPath), { recursive: true });
  writeFileSync(`${runtimeConfigPath}.tmp`, `${JSON.stringify(runtimeConfig, null, 2)}\n`);
  renameSync(`${runtimeConfigPath}.tmp`, runtimeConfigPath);
};

const initialRuntimeConfig = applyConfigPatch(envRuntimeConfig(), readPersistedConfig());

export const config: RuntimeConfig & { port: number } = {
  port: Number(process.env.PORT ?? 4000),
  ...initialRuntimeConfig
};

export const publicConfig = (): RuntimeConfig => ({
  pollIntervalMs: config.pollIntervalMs,
  alertThresholdPercent: config.alertThresholdPercent,
  discordWebhookUrl: config.discordWebhookUrl,
  trackedMarkets: [...config.trackedMarkets],
  enabledExchanges: [...config.enabledExchanges],
  exchangeFees: { ...config.exchangeFees },
  customQuoteEndpoints: config.customQuoteEndpoints.map((endpoint) => ({ ...endpoint }))
});

export const updateConfig = (input: Partial<RuntimeConfig>): RuntimeConfig => {
  const nextConfig = applyConfigPatch(publicConfig(), input);

  config.pollIntervalMs = nextConfig.pollIntervalMs;
  config.alertThresholdPercent = nextConfig.alertThresholdPercent;
  config.discordWebhookUrl = nextConfig.discordWebhookUrl;
  config.trackedMarkets = nextConfig.trackedMarkets;
  config.enabledExchanges = nextConfig.enabledExchanges;
  config.exchangeFees = nextConfig.exchangeFees;
  config.customQuoteEndpoints = nextConfig.customQuoteEndpoints;
  persistConfig(nextConfig);

  return publicConfig();
};
