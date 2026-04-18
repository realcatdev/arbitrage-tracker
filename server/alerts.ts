import { config } from "./config.js";
import type { Opportunity } from "../shared/types.js";

const recentlySent = new Map<string, number>();
const cooldownMs = 60_000;

const shouldSend = (opportunity: Opportunity): boolean => {
  if (opportunity.estimatedProfitPercent < config.alertThresholdPercent) {
    return false;
  }

  const lastSent = recentlySent.get(opportunity.id) ?? 0;
  return Date.now() - lastSent > cooldownMs;
};

const formatMoney = (value: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);

export const sendDiscordAlert = async (opportunity: Opportunity): Promise<void> => {
  if (!config.discordWebhookUrl || !shouldSend(opportunity)) {
    return;
  }

  recentlySent.set(opportunity.id, Date.now());

  const content = [
    `arbitrage alert: ${opportunity.symbol}`,
    `buy ${opportunity.buyExchange} @ ${formatMoney(opportunity.buyAsk)}`,
    `sell ${opportunity.sellExchange} @ ${formatMoney(opportunity.sellBid)}`,
    `estimated net spread: ${opportunity.estimatedProfitPercent.toFixed(3)}%`
  ].join("\n");

  await fetch(config.discordWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  });
};
