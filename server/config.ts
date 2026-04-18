import "dotenv/config";

const parseMarkets = (value: string | undefined): string[] =>
  (value ?? "BTC/USD,ETH/USD,SOL/USD")
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol));

const parseExchangeFees = (value: string | undefined): Record<string, number> => {
  const defaults: Record<string, number> = {
    binance: 0.001,
    kraken: 0.0026,
    coinbase: 0.006
  };

  for (const pair of value?.split(",") ?? []) {
    const [exchange, rawFee] = pair.split(":").map((part) => part.trim());
    const fee = Number(rawFee);

    if (exchange && Number.isFinite(fee) && fee >= 0) {
      defaults[exchange.toLowerCase()] = fee;
    }
  }

  return defaults;
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

export const config = {
  port: Number(process.env.PORT ?? 4000),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 3000),
  alertThresholdPercent: Number(process.env.ALERT_THRESHOLD_PERCENT ?? 0.25),
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim() || null,
  trackedMarkets: parseMarkets(process.env.TRACKED_MARKETS),
  exchangeFees: parseExchangeFees(process.env.EXCHANGE_FEES),
  customQuoteEndpoints: parseCustomEndpoints(process.env.CUSTOM_QUOTE_ENDPOINTS)
};
