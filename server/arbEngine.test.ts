import assert from "node:assert/strict";
import test from "node:test";
import { calculateOpportunities } from "./arbEngine.js";
import type { Quote } from "../shared/types.js";

const baseQuote = {
  symbol: "BTC/USD" as const,
  timestamp: 1,
  quoteSource: "test"
};

test("uses buy ask, sell bid, and both trading fees", () => {
  const quotes: Quote[] = [
    {
      ...baseQuote,
      exchange: "binance",
      bid: 100,
      ask: 101,
      feeRate: 0.001
    },
    {
      ...baseQuote,
      exchange: "kraken",
      bid: 103,
      ask: 104,
      feeRate: 0.002
    }
  ];

  const [best] = calculateOpportunities(quotes);

  assert.equal(best.buyExchange, "binance");
  assert.equal(best.sellExchange, "kraken");
  assert.equal(best.grossSpread, 2);
  assert.equal(Number(best.feeCost.toFixed(3)), 0.307);
  assert.equal(Number(best.estimatedProfit.toFixed(3)), 1.693);
  assert.equal(Number(best.estimatedProfitPercent.toFixed(3)), 1.676);
});

test("sorts opportunities by estimated profit percent descending", () => {
  const quotes: Quote[] = [
    {
      ...baseQuote,
      exchange: "binance",
      bid: 98,
      ask: 99,
      feeRate: 0.001
    },
    {
      ...baseQuote,
      exchange: "kraken",
      bid: 103,
      ask: 104,
      feeRate: 0.002
    },
    {
      ...baseQuote,
      exchange: "coinbase",
      bid: 101,
      ask: 102,
      feeRate: 0.006
    }
  ];

  const opportunities = calculateOpportunities(quotes);

  assert.equal(opportunities[0].id, "BTC/USD:binance->kraken");
  assert.ok(
    opportunities.every((opportunity, index) => {
      const next = opportunities[index + 1];
      return !next || opportunity.estimatedProfitPercent >= next.estimatedProfitPercent;
    })
  );
});
