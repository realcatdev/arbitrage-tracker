import { useEffect, useMemo, useRef, useState } from "react";
import type { ExchangeId, MarketSnapshot, Opportunity, Quote } from "../shared/types";
import { useMarketStream } from "./hooks/useMarketStream";

const exchangeLabels: Record<ExchangeId, string> = {
  binance: "Binance",
  kraken: "Kraken",
  coinbase: "Coinbase"
};

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 1000 ? 0 : 2
  }).format(value);

const formatPercent = (value: number): string => `${value.toFixed(3)}%`;

const timeAgo = (timestamp: number | null): string => {
  if (!timestamp) {
    return "never";
  }

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return seconds < 2 ? "now" : `${seconds}s ago`;
};

const bestOpportunity = (snapshot: MarketSnapshot | null): Opportunity | null =>
  snapshot?.opportunities[0] ?? null;

const quoteKey = (quote: Quote): string => `${quote.exchange}-${quote.symbol}`;

function App() {
  const { snapshot, connectionState, lastMessageAt } = useMarketStream();
  const [threshold, setThreshold] = useState(0.25);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const lastBrowserAlert = useRef<string | null>(null);

  const profitable = useMemo(
    () =>
      (snapshot?.opportunities ?? []).filter(
        (opportunity) => opportunity.estimatedProfitPercent >= threshold
      ),
    [snapshot?.opportunities, threshold]
  );

  const top = bestOpportunity(snapshot);

  useEffect(() => {
    const best = profitable[0];

    const alertKey = best ? `${best.id}:${Math.floor(best.timestamp / 60_000)}` : null;

    if (
      !best ||
      !alertKey ||
      lastBrowserAlert.current === alertKey ||
      !notificationsEnabled ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    lastBrowserAlert.current = alertKey;
    const notification = new Notification(`${best.symbol} spread detected`, {
      body: `${exchangeLabels[best.buyExchange]} to ${exchangeLabels[best.sellExchange]} at ${formatPercent(
        best.estimatedProfitPercent
      )} after fees.`
    });

    const timeout = window.setTimeout(() => notification.close(), 7000);
    return () => window.clearTimeout(timeout);
  }, [notificationsEnabled, profitable]);

  const requestNotifications = async () => {
    if (!("Notification" in window)) {
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationsEnabled(permission === "granted");
  };

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">market inefficiency detector</p>
          <h1>Arbitrage Tracker</h1>
          <p className="lede">
            Live cross-exchange bid/ask spreads with fee-aware profit estimates.
          </p>
        </div>
        <div className="statusCluster" aria-label="stream status">
          <span className={`pulse ${connectionState}`} />
          <span>{connectionState}</span>
          <span className="muted">updated {timeAgo(lastMessageAt)}</span>
        </div>
      </header>

      <section className="controlBand" aria-label="controls">
        <label className="thresholdControl">
          <span>alert threshold</span>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
          />
          <strong>{formatPercent(threshold)}</strong>
        </label>
        <button className="iconButton" type="button" onClick={requestNotifications}>
          <span aria-hidden="true">!</span>
          {notificationsEnabled ? "notifications on" : "enable alerts"}
        </button>
      </section>

      <section className="overview" aria-label="market overview">
        <Metric
          label="best net spread"
          value={top ? formatPercent(top.estimatedProfitPercent) : "waiting"}
          detail={top ? `${top.symbol} after fees` : "polling exchanges"}
          isPositive={Boolean(top && top.estimatedProfit > 0)}
        />
        <Metric
          label="opportunities"
          value={String(profitable.length)}
          detail={`above ${formatPercent(threshold)}`}
          isPositive={profitable.length > 0}
        />
        <Metric
          label="markets"
          value={String(snapshot?.quotes.length ?? 0)}
          detail={`${snapshot?.pollIntervalMs ?? 3000}ms polling`}
        />
        <Metric
          label="exchanges"
          value={String(snapshot?.statuses.filter((status) => status.ok).length ?? 0)}
          detail="online now"
        />
      </section>

      <section className="workspace">
        <div className="tablePanel opportunitiesPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">ranked by estimated net profit</p>
              <h2>Opportunities</h2>
            </div>
          </div>
          <OpportunityTable opportunities={snapshot?.opportunities ?? []} threshold={threshold} />
        </div>

        <aside className="sideRail">
          <ExchangeStatus snapshot={snapshot} />
          <QuoteTape quotes={snapshot?.quotes ?? []} />
        </aside>
      </section>
    </main>
  );
}

interface MetricProps {
  label: string;
  value: string;
  detail: string;
  isPositive?: boolean;
}

function Metric({ label, value, detail, isPositive = false }: MetricProps) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={isPositive ? "positiveText" : undefined}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function OpportunityTable({
  opportunities,
  threshold
}: {
  opportunities: Opportunity[];
  threshold: number;
}) {
  if (opportunities.length === 0) {
    return <p className="empty">waiting for usable bid/ask data from at least two exchanges.</p>;
  }

  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Pair</th>
            <th>Buy @</th>
            <th>Sell @</th>
            <th>Spread</th>
            <th>Est. profit</th>
            <th>Route</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opportunity) => {
            const active = opportunity.estimatedProfitPercent >= threshold;

            return (
              <tr className={active ? "profitable" : undefined} key={opportunity.id}>
                <td>{opportunity.symbol}</td>
                <td>{formatCurrency(opportunity.buyAsk)}</td>
                <td>{formatCurrency(opportunity.sellBid)}</td>
                <td>{formatPercent(opportunity.grossSpreadPercent)}</td>
                <td>
                  <strong className={opportunity.estimatedProfit > 0 ? "positiveText" : "lossText"}>
                    {formatCurrency(opportunity.estimatedProfit)}
                  </strong>
                  <span className="subtle">{formatPercent(opportunity.estimatedProfitPercent)}</span>
                </td>
                <td>
                  {exchangeLabels[opportunity.buyExchange]}{" -> "}
                  {exchangeLabels[opportunity.sellExchange]}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExchangeStatus({ snapshot }: { snapshot: MarketSnapshot | null }) {
  return (
    <section className="railPanel">
      <div className="panelHeader compact">
        <h2>Exchanges</h2>
      </div>
      <div className="statusList">
        {(snapshot?.statuses ?? []).map((status) => (
          <div className="statusRow" key={status.exchange}>
            <span className={`dot ${status.ok ? "ok" : "bad"}`} />
            <div>
              <strong>{exchangeLabels[status.exchange]}</strong>
              <span>{status.message}</span>
            </div>
            <small>{timeAgo(status.lastUpdate)}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function QuoteTape({ quotes }: { quotes: Quote[] }) {
  return (
    <section className="railPanel">
      <div className="panelHeader compact">
        <h2>Live quotes</h2>
      </div>
      <div className="quoteTape">
        {quotes.map((quote) => (
          <div className="quoteRow" key={quoteKey(quote)}>
            <div>
              <strong>{quote.symbol}</strong>
              <span>{exchangeLabels[quote.exchange]}</span>
            </div>
            <div>
              <span>{formatCurrency(quote.bid)}</span>
              <span>{formatCurrency(quote.ask)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export { App };
