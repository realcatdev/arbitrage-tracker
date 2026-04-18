import express from "express";
import http from "node:http";
import { WebSocketServer } from "ws";
import { calculateOpportunities, buildSnapshot } from "./arbEngine.js";
import { sendDiscordAlert } from "./alerts.js";
import { config, publicConfig, updateConfig } from "./config.js";
import { fetchAllQuotes, testCustomEndpoint } from "./exchanges.js";
import type { CustomQuoteEndpoint, MarketSnapshot } from "../shared/types.js";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

let latestSnapshot: MarketSnapshot | null = null;
let pollTimer: NodeJS.Timeout | null = null;

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    updatedAt: latestSnapshot?.updatedAt ?? null,
    exchanges: latestSnapshot?.statuses ?? []
  });
});

app.get("/api/snapshot", (_request, response) => {
  if (!latestSnapshot) {
    response.status(503).json({ message: "snapshot not ready" });
    return;
  }

  response.json(latestSnapshot);
});

app.get("/api/config", (_request, response) => {
  response.json(publicConfig());
});

const broadcast = (snapshot: MarketSnapshot): void => {
  const payload = JSON.stringify({ type: "snapshot", snapshot });

  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) {
      client.send(payload);
    }
  }
};

const poll = async (): Promise<void> => {
  const results = await fetchAllQuotes();
  const quotes = results.flatMap((result) => result.quotes);
  const statuses = results.map((result) => result.status);
  const opportunities = calculateOpportunities(quotes);
  const snapshot = buildSnapshot(
    latestSnapshot,
    quotes,
    opportunities,
    statuses,
    config.trackedMarkets,
    config.pollIntervalMs,
    config.alertThresholdPercent
  );

  latestSnapshot = snapshot;
  broadcast(snapshot);

  const best = opportunities[0];
  if (best) {
    await sendDiscordAlert(best).catch((error) => {
      console.error("discord alert failed", error);
    });
  }
};

const schedulePoll = (): void => {
  if (pollTimer) {
    clearTimeout(pollTimer);
  }

  pollTimer = setTimeout(() => {
    void poll()
      .catch((error) => {
        console.error("poll failed", error);
      })
      .finally(schedulePoll);
  }, config.pollIntervalMs);
};

app.patch("/api/config", async (request, response) => {
  const nextConfig = updateConfig(request.body);

  await poll().catch((error) => {
    console.error("poll failed after config update", error);
  });
  schedulePoll();

  response.json(nextConfig);
});

app.post("/api/custom-endpoints/test", async (request, response) => {
  const endpoint = request.body as CustomQuoteEndpoint;

  if (!endpoint?.name || !endpoint?.url) {
    response.status(400).json({
      ok: false,
      message: "endpoint name and url are required",
      quoteCount: 0
    });
    return;
  }

  const result = await testCustomEndpoint(endpoint);
  response.status(result.ok ? 200 : 422).json(result);
});

wss.on("connection", (socket) => {
  if (latestSnapshot) {
    socket.send(JSON.stringify({ type: "snapshot", snapshot: latestSnapshot }));
  }
});

server.listen(config.port, () => {
  console.log(`arbitrage tracker api listening on http://localhost:${config.port}`);
});

void poll().finally(schedulePoll);
