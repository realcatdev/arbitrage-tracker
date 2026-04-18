import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CustomEndpointTestResult,
  CustomQuoteEndpoint,
  ExchangeCheck,
  ExchangeId,
  ExchangeStatus as ExchangeStatusType,
  MarketSnapshot,
  Opportunity,
  Quote,
  RuntimeConfig
} from "../shared/types";
import { useMarketStream } from "./hooks/useMarketStream";

const builtInExchangeLabels: Record<string, string> = {
  binance: "Binance",
  kraken: "Kraken",
  coinbase: "Coinbase"
};

const exchangeLabel = (exchange: ExchangeId): string =>
  builtInExchangeLabels[exchange] ??
  exchange
    .split(/[-_\s]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value > 1000 ? 0 : 2
  }).format(value);

const formatPercent = (value: number): string => `${value.toFixed(3)}%`;

const timeAgo = (timestamp: number | null): string => {
  if (!timestamp) {
    return "Never";
  }

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return seconds < 2 ? "Now" : `${seconds}s Ago`;
};

const bestOpportunity = (snapshot: MarketSnapshot | null): Opportunity | null =>
  snapshot?.opportunities[0] ?? null;

const quoteKey = (quote: Quote): string => `${quote.exchange}-${quote.symbol}`;
const checkKey = (check: ExchangeCheck): string =>
  `${check.symbol}-${check.sourceSymbol}-${check.ok ? "ok" : "fail"}`;

const emptyConfig: RuntimeConfig = {
  pollIntervalMs: 3000,
  alertThresholdPercent: 0.25,
  discordWebhookUrl: null,
  trackedMarkets: ["BTC/USD", "ETH/USD", "SOL/USD"],
  exchangeFees: {
    binance: 0.001,
    kraken: 0.0026,
    coinbase: 0.006
  },
  customQuoteEndpoints: []
};

const headersToText = (headers: Record<string, string> | undefined): string =>
  Object.entries(headers ?? {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

const textToHeaders = (value: string): Record<string, string> =>
  Object.fromEntries(
    value
      .split("\n")
      .map((line) => {
        const separator = line.indexOf(":");
        return separator > 0
          ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
          : ["", ""];
      })
      .filter(([key, headerValue]) => key && headerValue)
  );

function App() {
  const { snapshot, connectionState, lastMessageAt } = useMarketStream();
  const [threshold, setThreshold] = useState(0.25);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("all");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const lastBrowserAlert = useRef<string | null>(null);

  const visibleSymbols = useMemo(() => {
    const quoteSymbols = (snapshot?.quotes ?? []).map((quote) => quote.symbol);
    return Array.from(new Set([...(snapshot?.trackedSymbols ?? []), ...quoteSymbols])).sort();
  }, [snapshot?.quotes, snapshot?.trackedSymbols]);

  const visibleOpportunities = useMemo(
    () =>
      selectedSymbol === "all"
        ? (snapshot?.opportunities ?? [])
        : (snapshot?.opportunities ?? []).filter(
            (opportunity) => opportunity.symbol === selectedSymbol
          ),
    [selectedSymbol, snapshot?.opportunities]
  );

  const visibleQuotes = useMemo(
    () =>
      selectedSymbol === "all"
        ? (snapshot?.quotes ?? [])
        : (snapshot?.quotes ?? []).filter((quote) => quote.symbol === selectedSymbol),
    [selectedSymbol, snapshot?.quotes]
  );

  const profitable = useMemo(
    () =>
      visibleOpportunities.filter(
        (opportunity) => opportunity.estimatedProfitPercent >= threshold
      ),
    [threshold, visibleOpportunities]
  );

  const top = visibleOpportunities[0] ?? bestOpportunity(snapshot);

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
      body: `${exchangeLabel(best.buyExchange)} to ${exchangeLabel(best.sellExchange)} at ${formatPercent(
        best.estimatedProfitPercent
      )} After Fees.`
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
          <p className="eyebrow">Market Inefficiency Detector</p>
          <h1>Arbitrage Tracker</h1>
          <p className="lede">
            Live cross-exchange bid/ask spreads with fee-aware profit estimates.
          </p>
        </div>
        <div className="statusCluster" aria-label="Stream Status">
          <span className={`pulse ${connectionState}`} />
          <span>{connectionState}</span>
          <span className="muted">Updated {timeAgo(lastMessageAt)}</span>
        </div>
      </header>

      <section className="controlBand" aria-label="Controls">
        <label className="thresholdControl">
          <span>Alert Threshold</span>
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
          {notificationsEnabled ? "Notifications On" : "Enable Alerts"}
        </button>
      </section>

      <section className="marketPicker" aria-label="Market Filter">
        <button
          className={selectedSymbol === "all" ? "active" : undefined}
          type="button"
          onClick={() => setSelectedSymbol("all")}
        >
          All Markets
        </button>
        {visibleSymbols.map((symbol) => (
          <button
            className={selectedSymbol === symbol ? "active" : undefined}
            key={symbol}
            type="button"
            onClick={() => setSelectedSymbol(symbol)}
          >
            {symbol}
          </button>
        ))}
      </section>

      <section className="overview" aria-label="Market Overview">
        <Metric
          label="Best Net Spread"
          value={top ? formatPercent(top.estimatedProfitPercent) : "Waiting"}
          detail={top ? `${top.symbol} After Fees` : "Polling Exchanges"}
          isPositive={Boolean(top && top.estimatedProfit > 0)}
        />
        <Metric
          label="Opportunities"
          value={String(profitable.length)}
          detail={`Above ${formatPercent(threshold)}`}
          isPositive={profitable.length > 0}
        />
        <Metric
          label="Markets"
          value={String(visibleSymbols.length)}
          detail={selectedSymbol === "all" ? `${snapshot?.pollIntervalMs ?? 3000}ms Polling` : selectedSymbol}
        />
        <Metric
          label="Exchanges"
          value={String(snapshot?.statuses.filter((status) => status.ok).length ?? 0)}
          detail="Online Now"
        />
      </section>

      <section className="workspace">
        <div className="tablePanel opportunitiesPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">Ranked By Estimated Net Profit</p>
              <h2>Opportunities</h2>
            </div>
          </div>
          <OpportunityTable opportunities={visibleOpportunities} threshold={threshold} />
        </div>

        <aside className="sideRail">
          <SettingsPanel snapshot={snapshot} />
          <ExchangeStatus snapshot={snapshot} />
          <QuoteTape quotes={visibleQuotes} />
        </aside>
      </section>
    </main>
  );
}

function SettingsPanel({ snapshot }: { snapshot: MarketSnapshot | null }) {
  const [config, setConfig] = useState<RuntimeConfig>(emptyConfig);
  const [newBase, setNewBase] = useState("");
  const [newQuote, setNewQuote] = useState("USD");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [endpointTests, setEndpointTests] = useState<Record<number, CustomEndpointTestResult>>({});

  useEffect(() => {
    let disposed = false;

    fetch("/api/config")
      .then((response) => response.json() as Promise<RuntimeConfig>)
      .then((payload) => {
        if (!disposed) {
          setConfig(payload);
        }
      })
      .catch(() => {
        if (!disposed) {
          setSaveState("error");
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  const feeExchanges = useMemo(() => {
    const exchanges = new Set([
      "binance",
      "kraken",
      "coinbase",
      ...Object.keys(config.exchangeFees),
      ...(snapshot?.statuses.map((status) => status.exchange) ?? []),
      ...config.customQuoteEndpoints.map((endpoint) => endpoint.name)
    ]);

    return Array.from(exchanges).sort();
  }, [config.customQuoteEndpoints, config.exchangeFees, snapshot?.statuses]);

  const updateField = <Key extends keyof RuntimeConfig>(key: Key, value: RuntimeConfig[Key]) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setSaveState("idle");
  };

  const addMarket = () => {
    const base = newBase.trim().toUpperCase();
    const quote = newQuote.trim().toUpperCase();
    const symbol = `${base}/${quote}`;

    if (!/^[A-Z0-9]+\/[A-Z0-9]+$/.test(symbol)) {
      setSaveState("error");
      return;
    }

    updateField("trackedMarkets", Array.from(new Set([...config.trackedMarkets, symbol])));
    setNewBase("");
  };

  const removeMarket = (symbol: string) => {
    const nextMarkets = config.trackedMarkets.filter((market) => market !== symbol);
    updateField("trackedMarkets", nextMarkets.length > 0 ? nextMarkets : [symbol]);
  };

  const updateFee = (exchange: string, value: string) => {
    const fee = Number(value);

    if (!Number.isFinite(fee) || fee < 0) {
      return;
    }

    updateField("exchangeFees", {
      ...config.exchangeFees,
      [exchange]: fee
    });
  };

  const updateEndpoint = <Key extends keyof CustomQuoteEndpoint>(
    index: number,
    key: Key,
    value: CustomQuoteEndpoint[Key]
  ) => {
    const endpoints = config.customQuoteEndpoints.map((endpoint, endpointIndex) =>
      endpointIndex === index ? { ...endpoint, [key]: value } : endpoint
    );
    updateField("customQuoteEndpoints", endpoints);
  };

  const addEndpoint = () => {
    updateField("customQuoteEndpoints", [
      ...config.customQuoteEndpoints,
      { name: "custom", url: "http://localhost:9000/quotes", headers: {} }
    ]);
  };

  const removeEndpoint = (index: number) => {
    updateField(
      "customQuoteEndpoints",
      config.customQuoteEndpoints.filter((_endpoint, endpointIndex) => endpointIndex !== index)
    );
  };

  const testEndpoint = async (endpoint: CustomQuoteEndpoint, index: number) => {
    setEndpointTests((current) => ({
      ...current,
      [index]: { ok: false, message: "Testing...", quoteCount: 0 }
    }));

    try {
      const response = await fetch("/api/custom-endpoints/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(endpoint)
      });
      const payload = (await response.json()) as CustomEndpointTestResult;

      setEndpointTests((current) => ({ ...current, [index]: payload }));
    } catch {
      setEndpointTests((current) => ({
        ...current,
        [index]: { ok: false, message: "Request Failed", quoteCount: 0 }
      }));
    }
  };

  const saveConfig = async () => {
    setSaveState("saving");

    try {
      const response = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });

      if (!response.ok) {
        throw new Error("config save failed");
      }

      const payload = (await response.json()) as RuntimeConfig;
      setConfig(payload);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  return (
    <section className="railPanel settingsPanel">
      <div className="panelHeader compact">
        <div>
          <p className="eyebrow">Runtime Controls</p>
          <h2>Developer Settings</h2>
        </div>
        <button className="saveButton" type="button" onClick={saveConfig}>
          {saveState === "saving" ? "Saving" : "Save"}
        </button>
      </div>

      <div className="settingsBody">
        <label className="field">
          <span>Poll Interval Ms</span>
          <input
            min="1000"
            step="500"
            type="number"
            value={config.pollIntervalMs}
            onChange={(event) => updateField("pollIntervalMs", Number(event.target.value))}
          />
        </label>

        <label className="field">
          <span>Alert Threshold %</span>
          <input
            min="0"
            step="0.05"
            type="number"
            value={config.alertThresholdPercent}
            onChange={(event) =>
              updateField("alertThresholdPercent", Number(event.target.value))
            }
          />
        </label>

        <label className="field wide">
          <span>Discord Webhook</span>
          <input
            placeholder="https://discord.com/api/webhooks/..."
            type="url"
            value={config.discordWebhookUrl ?? ""}
            onChange={(event) => updateField("discordWebhookUrl", event.target.value || null)}
          />
        </label>

        <div className="settingGroup">
          <span>Markets</span>
          <div className="tokenList">
            {config.trackedMarkets.map((symbol) => (
              <button key={symbol} type="button" onClick={() => removeMarket(symbol)}>
                {symbol} X
              </button>
            ))}
          </div>
          <div className="marketComposer">
            <input
              aria-label="Base Currency"
              placeholder="DOGE"
              value={newBase}
              onChange={(event) => setNewBase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addMarket();
                }
              }}
            />
            <span>/</span>
            <input
              aria-label="Quote Currency"
              placeholder="USD"
              value={newQuote}
              onChange={(event) => setNewQuote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addMarket();
                }
              }}
            />
            <button type="button" onClick={addMarket}>
              Add
            </button>
          </div>
        </div>

        <div className="settingGroup">
          <span>Fees</span>
          <div className="feeGrid">
            {feeExchanges.map((exchange) => (
              <label key={exchange}>
                <span>{exchangeLabel(exchange)}</span>
                <input
                  min="0"
                  step="0.0001"
                  type="number"
                  value={config.exchangeFees[exchange] ?? 0}
                  onChange={(event) => updateFee(exchange, event.target.value)}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="settingGroup">
          <div className="groupTitle">
            <span>Custom Quote APIs</span>
            <button type="button" onClick={addEndpoint}>
              Add API
            </button>
          </div>
          {config.customQuoteEndpoints.length === 0 ? (
            <p className="settingsHint">No Custom Quote APIs Connected.</p>
          ) : (
            config.customQuoteEndpoints.map((endpoint, index) => (
              <div className="endpointStack" key={`${endpoint.name}-${index}`}>
                <div className="endpointRow">
                  <input
                    aria-label="API Name"
                    placeholder="My Desk"
                    value={endpoint.name}
                    onChange={(event) => updateEndpoint(index, "name", event.target.value)}
                  />
                  <input
                    aria-label="API URL"
                    placeholder="http://localhost:9000/quotes"
                    value={endpoint.url}
                    onChange={(event) => updateEndpoint(index, "url", event.target.value)}
                  />
                </div>
                <textarea
                  aria-label="API Headers"
                  placeholder={"Authorization: Bearer token\nX-API-Key: key"}
                  value={headersToText(endpoint.headers)}
                  onChange={(event) =>
                    updateEndpoint(index, "headers", textToHeaders(event.target.value))
                  }
                />
                <div className="endpointActions">
                  <button type="button" onClick={() => testEndpoint(endpoint, index)}>
                    Test
                  </button>
                  <button type="button" onClick={() => removeEndpoint(index)}>
                    Remove
                  </button>
                  {endpointTests[index] ? (
                    <span className={endpointTests[index].ok ? "testOk" : "testBad"}>
                      {endpointTests[index].message}
                    </span>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        <p className={`saveState ${saveState}`}>
          {saveState === "saved"
            ? "Saved And Repolling"
            : saveState === "error"
              ? "Check The Values And Try Again"
              : "Changes Apply After Save"}
        </p>
      </div>
    </section>
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
    return <p className="empty">Waiting For Usable Bid/Ask Data From At Least Two Exchanges.</p>;
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
            <th>Est. Profit</th>
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
                  {exchangeLabel(opportunity.buyExchange)}
                  {" -> "}
                  {exchangeLabel(opportunity.sellExchange)}
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
  const [expandedExchange, setExpandedExchange] = useState<string | null>(null);
  const statuses = snapshot?.statuses ?? [];

  return (
    <section className="railPanel">
      <div className="panelHeader compact">
        <div>
          <p className="eyebrow">Click For Trace</p>
          <h2>Exchanges</h2>
        </div>
      </div>
      <div className="statusList">
        {statuses.map((status) => {
          const expanded = expandedExchange === status.exchange;
          const passed = status.successCount ?? status.checks?.filter((check) => check.ok).length ?? 0;
          const failed = status.failureCount ?? status.checks?.filter((check) => !check.ok).length ?? 0;

          return (
            <div className="exchangeBlock" key={status.exchange}>
              <button
                aria-expanded={expanded}
                className="statusRow statusButton"
                type="button"
                onClick={() => setExpandedExchange(expanded ? null : status.exchange)}
              >
                <span className={`dot ${status.ok ? "ok" : "bad"}`} />
                <div>
                  <strong>{exchangeLabel(status.exchange)}</strong>
                  <span>{status.message}</span>
                </div>
                <div className="statusMeta">
                  <small>{timeAgo(status.lastUpdate)}</small>
                  <span className="miniStats">
                    {passed} OK / {failed} Fail
                  </span>
                </div>
              </button>
              {expanded ? <ExchangeDetails status={status} /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ExchangeDetails({ status }: { status: ExchangeStatusType }) {
  const checks = status.checks ?? [];

  if (checks.length === 0) {
    return <p className="diagnosticEmpty">No Request Diagnostics Reported Yet.</p>;
  }

  return (
    <div className="diagnostics">
      {checks.map((check) => (
        <div className={`diagnosticRow ${check.ok ? "passed" : "failed"}`} key={checkKey(check)}>
          <div className="diagnosticHead">
            <strong>{check.symbol}</strong>
            <span>{check.ok ? "Passed" : "Failed"}</span>
          </div>
          <dl>
            <div>
              <dt>Source</dt>
              <dd>{check.sourceSymbol}</dd>
            </div>
            <div>
              <dt>Code</dt>
              <dd>{check.code ?? "OK"}</dd>
            </div>
            <div>
              <dt>Latency</dt>
              <dd>{check.latencyMs ?? 0}ms</dd>
            </div>
            <div>
              <dt>Message</dt>
              <dd>{check.message}</dd>
            </div>
            {check.quoteSource ? (
              <div>
                <dt>Quote</dt>
                <dd>{check.quoteSource}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ))}
    </div>
  );
}

function QuoteTape({ quotes }: { quotes: Quote[] }) {
  return (
    <section className="railPanel">
      <div className="panelHeader compact">
        <h2>Live Quotes</h2>
      </div>
      <div className="quoteTape">
        {quotes.map((quote) => (
          <div className="quoteRow" key={quoteKey(quote)}>
            <div>
              <strong>{quote.symbol}</strong>
              <span>{exchangeLabel(quote.exchange)}</span>
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
