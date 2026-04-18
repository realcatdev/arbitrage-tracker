import type { MarketSnapshot, Opportunity, Quote } from "../shared/types.js";

const opportunityId = (
  symbol: string,
  buyExchange: string,
  sellExchange: string
): string => `${symbol}:${buyExchange}->${sellExchange}`;

const groupBySymbol = (quotes: Quote[]): Map<string, Quote[]> => {
  const grouped = new Map<string, Quote[]>();

  for (const quote of quotes) {
    const current = grouped.get(quote.symbol) ?? [];
    current.push(quote);
    grouped.set(quote.symbol, current);
  }

  return grouped;
};

export const calculateOpportunities = (quotes: Quote[]): Opportunity[] => {
  const grouped = groupBySymbol(quotes);
  const opportunities: Opportunity[] = [];

  for (const [symbol, symbolQuotes] of grouped.entries()) {
    for (const buy of symbolQuotes) {
      for (const sell of symbolQuotes) {
        if (buy.exchange === sell.exchange) {
          continue;
        }

        const grossSpread = sell.bid - buy.ask;
        const grossSpreadPercent = (grossSpread / buy.ask) * 100;
        const feeCost = buy.ask * buy.feeRate + sell.bid * sell.feeRate;
        const estimatedProfit = grossSpread - feeCost;
        const estimatedProfitPercent = (estimatedProfit / buy.ask) * 100;

        opportunities.push({
          id: opportunityId(symbol, buy.exchange, sell.exchange),
          symbol: buy.symbol,
          buyExchange: buy.exchange,
          sellExchange: sell.exchange,
          buyAsk: buy.ask,
          sellBid: sell.bid,
          grossSpread,
          grossSpreadPercent,
          feeCost,
          estimatedProfit,
          estimatedProfitPercent,
          timestamp: Math.max(buy.timestamp, sell.timestamp)
        });
      }
    }
  }

  return [...opportunities].sort(
    (left, right) => right.estimatedProfitPercent - left.estimatedProfitPercent
  );
};

export const buildSnapshot = (
  previous: MarketSnapshot | null,
  quotes: Quote[],
  opportunities: Opportunity[],
  statuses: MarketSnapshot["statuses"],
  pollIntervalMs: number,
  thresholdPercent: number
): MarketSnapshot => ({
  quotes: quotes.length > 0 ? quotes : previous?.quotes ?? [],
  opportunities: opportunities.length > 0 ? opportunities : previous?.opportunities ?? [],
  statuses,
  updatedAt: Date.now(),
  pollIntervalMs,
  thresholdPercent
});
