import express from "express";
import http from "node:http";
import { WebSocketServer } from "ws";
import { calculateOpportunities, buildSnapshot } from "./arbEngine.js";
import { sendDiscordAlert } from "./alerts.js";
import { config } from "./config.js";
import { fetchAllQuotes } from "./exchanges.js";
import type { MarketSnapshot } from "../shared/types.js";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

let latestSnapshot: MarketSnapshot | null = null;

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

wss.on("connection", (socket) => {
  if (latestSnapshot) {
    socket.send(JSON.stringify({ type: "snapshot", snapshot: latestSnapshot }));
  }
});

server.listen(config.port, () => {
  console.log(`arbitrage tracker api listening on http://localhost:${config.port}`);
});

void poll();
setInterval(() => {
  void poll().catch((error) => {
    console.error("poll failed", error);
  });
}, config.pollIntervalMs);
