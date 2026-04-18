export type ExchangeId = string;

export type AssetSymbol = string;

export interface Quote {
  exchange: ExchangeId;
  symbol: AssetSymbol;
  bid: number;
  ask: number;
  feeRate: number;
  quoteSource: string;
  timestamp: number;
}

export interface ExchangeStatus {
  exchange: ExchangeId;
  ok: boolean;
  lastUpdate: number | null;
  message: string;
}

export interface CustomQuoteEndpoint {
  name: string;
  url: string;
}

export interface RuntimeConfig {
  pollIntervalMs: number;
  alertThresholdPercent: number;
  discordWebhookUrl: string | null;
  trackedMarkets: AssetSymbol[];
  exchangeFees: Record<ExchangeId, number>;
  customQuoteEndpoints: CustomQuoteEndpoint[];
}

export interface Opportunity {
  id: string;
  symbol: AssetSymbol;
  buyExchange: ExchangeId;
  sellExchange: ExchangeId;
  buyAsk: number;
  sellBid: number;
  grossSpread: number;
  grossSpreadPercent: number;
  feeCost: number;
  estimatedProfit: number;
  estimatedProfitPercent: number;
  timestamp: number;
}

export interface MarketSnapshot {
  quotes: Quote[];
  opportunities: Opportunity[];
  statuses: ExchangeStatus[];
  trackedSymbols: AssetSymbol[];
  updatedAt: number;
  pollIntervalMs: number;
  thresholdPercent: number;
}

export interface AlertEvent {
  id: string;
  opportunity: Opportunity;
  createdAt: number;
}
