import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { fetchCustomEndpointQuotes, testCustomEndpoint } from "./exchanges.js";

const withQuoteServer = async (
  handler: http.RequestListener,
  run: (url: string) => Promise<void>
): Promise<void> => {
  const server = http.createServer(handler);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await run(`http://127.0.0.1:${address.port}/quotes`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
};

test("custom endpoint with an invalid token returns a failed status instead of throwing", async () => {
  await withQuoteServer(
    (request, response) => {
      if (request.headers.authorization !== "Bearer valid-token") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify([{ symbol: "BTC/USD", bid: 100, ask: 101 }]));
    },
    async (url) => {
      const result = await fetchCustomEndpointQuotes("private", url, {
        Authorization: "Bearer invalid-token"
      });

      assert.equal(result.status.ok, false);
      assert.equal(result.status.exchange, "private");
      assert.match(result.status.message, /401/);
      assert.deepEqual(result.quotes, []);
    }
  );
});

test("custom endpoint test reports invalid token failures as a normal result", async () => {
  await withQuoteServer(
    (_request, response) => {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "forbidden" }));
    },
    async (url) => {
      const result = await testCustomEndpoint({
        name: "private",
        url,
        headers: { Authorization: "Bearer invalid-token" }
      });

      assert.equal(result.ok, false);
      assert.equal(result.quoteCount, 0);
      assert.match(result.message, /403/);
    }
  );
});
