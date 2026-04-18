import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 3000),
  alertThresholdPercent: Number(process.env.ALERT_THRESHOLD_PERCENT ?? 0.25),
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL?.trim() || null
};
