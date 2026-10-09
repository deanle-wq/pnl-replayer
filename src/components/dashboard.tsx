"use client";

import { ArrowRight, CheckCircle, Code, Key, ShieldCheck, VideoCamera, WarningCircle } from "@phosphor-icons/react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch, setVisitorApiKey } from "@/lib/api-client";
import type { ApiUsage } from "@/server/birdeye/usage";
import type { BoardRow, TokenAnalysis } from "@/server/services/analyze-token";
import { WalletVideoModal } from "./wallet-video-modal";

const SAMPLE_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

/** The Birdeye Data endpoints this app is built on, shown as the hero's chip rail. */
const ENDPOINTS = [
  "Token - Top Traders",
  "Wallet - PnL (Multiple)",
  "Wallet - Balance Change",
  "Trades - Token (V3)",
  "OHLCV V3",
  "Token - Metadata",
  "Price",
];

function money(value: number, signed = false) {
  const body = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : Math.abs(value) >= 1_000_000 ? 2 : 0,
  }).format(Math.abs(value || 0));
  if (!signed) return value < 0 ? `−${body}` : body;
  return `${value < 0 ? "−" : "+"}${body}`;
}

function short(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-4)}`;
}

function PriceChart({ values }: { values: TokenAnalysis["candles"] }) {
  const { line, area } = useMemo(() => {
    if (values.length < 2) return { line: "", area: "" };
    const width = 960;
    const height = 220;
    const prices = values.map((item) => item.c);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const spread = max - min || 1;
    const points = values.map((item, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((item.c - min) / spread) * (height - 24) - 12;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return { line: points.join(" "), area: `0,${height} ${points.join(" ")} ${width},${height}` };
  }, [values]);

  return (
    <figure className="chart" aria-label="Token price history">
      {line ? (
        <svg viewBox="0 0 960 220" preserveAspectRatio="none" role="img" aria-label="Price chart">
          <defs>
            <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#61D38A" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#61D38A" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill="url(#chart-fill)" />
          <polyline points={line} fill="none" stroke="#61D38A" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <p>No candles returned for this range.</p>
      )}
      <figcaption>Price · {values[0]?.type ?? "OHLCV"} candles · Birdeye OHLCV V3</figcaption>
    </figure>
  );
}

function Confidence({ level, holderOnly }: { level?: "high" | "medium" | "low"; holderOnly?: boolean }) {
  if (!level && holderOnly) {
    return <Badge variant="outline" className="pill neutral" title="No swaps on this token: ranked by holdings only">Holder only</Badge>;
  }
  if (!level) return <Badge variant="outline" className="pill neutral">Birdeye WAC</Badge>;
  const Icon = level === "high" ? CheckCircle : level === "medium" ? ShieldCheck : WarningCircle;
  return (
    <Badge variant="outline" className={`pill ${level}`}>
      <Icon size={13} weight="fill" aria-hidden="true" /> {level[0]!.toUpperCase() + level.slice(1)} confidence
    </Badge>
  );
}

function EndpointRail() {
  // Rendered twice so the rail can loop seamlessly; the copy is hidden from assistive tech.
  return (
    <div className="endpoint-rail" aria-label="Birdeye Data endpoints used">
      <div className="endpoint-track">
        {[0, 1].map((copy) => (
          <ul key={copy} aria-hidden={copy === 1 ? true : undefined}>
            {ENDPOINTS.map((name) => <li key={name} className="glass-chip">{name}</li>)}
            <li className="glass-chip accent">Solana</li>
          </ul>
        ))}
      </div>
    </div>
  );
}

function UsagePanel({ passes, keySource }: { passes: Array<{ label: string; usage: ApiUsage }>; keySource?: "visitor" | "server" }) {
  if (passes.length === 0) return null;
  const endpoints = new Map<string, { requests: number; cu: number }>();
  for (const pass of passes) {
    for (const item of pass.usage.endpoints) {
      const held = endpoints.get(item.path) ?? { requests: 0, cu: 0 };
      held.requests += item.requests;
      held.cu += item.cu;
      endpoints.set(item.path, held);
    }
  }
  const totalCu = passes.reduce((sum, pass) => sum + pass.usage.cu, 0);
  const totalRequests = passes.reduce((sum, pass) => sum + pass.usage.requests, 0);
  const cached = passes.reduce((sum, pass) => sum + pass.usage.cacheHits, 0);
  return (
    <section className="usage-panel" aria-label="Birdeye Data API usage">
      <div className="section-title">
        <h2><Code size={18} aria-hidden="true" /> Built on Birdeye Data API</h2>
        <p>{totalRequests.toLocaleString()} billable requests · {totalCu.toLocaleString()} CU{cached ? ` · ${cached.toLocaleString()} served from cache` : ""}{keySource ? `, billed to ${keySource === "visitor" ? "your key" : "this app's key"}` : ""}. CU per Birdeye&apos;s published compute-unit table.</p>
      </div>
      <div className="table-wrap">
        <table className="usage-table">
          <thead>
            <tr><th>Endpoint</th><th className="number">Requests</th><th className="number">CU</th></tr>
          </thead>
          <tbody>
            {[...endpoints].sort((a, b) => b[1].cu - a[1].cu).map(([path, item]) => (
              <tr key={path}>
                <td><code>{path}</code></td>
                <td className="number">{item.requests.toLocaleString()}</td>
                <td className="number">{item.cu.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="usage-note">{passes.map((pass) => `${pass.label}: ${pass.usage.requests} requests, ${pass.usage.cu.toLocaleString()} CU`).join(" · ")}</p>
    </section>
  );
}

export function Dashboard() {
  const [mint, setMint] = useState(SAMPLE_MINT);
  const [data, setData] = useState<TokenAnalysis | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [videoWallet, setVideoWallet] = useState<string | null>(null);
  const [usage, setUsage] = useState<Array<{ label: string; usage: ApiUsage }>>([]);
  // Ledgers built from the Video modal. Kept apart from `data` so the
  // background audit response cannot overwrite a row the user already audited.
  const [ledgerRows, setLedgerRows] = useState<Record<string, BoardRow>>({});
  // The visitor's own Birdeye key: React state and api-client memory only.
  const [apiKey, setApiKey] = useState("");
  const [serverKey, setServerKey] = useState<boolean | null>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json())
      .then((health) => setServerKey(Boolean(health.configured)))
      .catch(() => setServerKey(false));
  }, []);

  const needsKey = serverKey === false && apiKey.trim() === "";

  async function analyze(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (needsKey) {
      setError("Add your Birdeye Data API key first. It stays in this tab's memory only.");
      keyInputRef.current?.focus();
      return;
    }
    setLoading(true);
    setAuditing(false);
    setLedgerRows({});
    setUsage([]);
    try {
      const encodedMint = encodeURIComponent(mint.trim());
      const response = await apiFetch(`/api/analyze?mint=${encodedMint}&audit=0`);
      const body = await response.json();
      if (!response.ok) {
        if (body.code?.startsWith("api_key")) keyInputRef.current?.focus();
        throw new Error(body.error ?? "Analysis failed");
      }
      setData(body);
      if (body.usage) setUsage([{ label: "Board", usage: body.usage }]);
      setLoading(false);

      setAuditing(true);
      const auditResponse = await apiFetch(`/api/analyze?mint=${encodedMint}&audit=1`);
      const auditedBody = await auditResponse.json();
      if (!auditResponse.ok) throw new Error(auditedBody.error ?? "Deep audit failed");
      setData(auditedBody);
      if (auditedBody.usage) setUsage((passes) => [...passes, { label: "Leading-wallet audit", usage: auditedBody.usage }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed");
    } finally {
      setLoading(false);
      setAuditing(false);
    }
  }

  async function loadDemo() {
    setError("");
    setLoading(true);
    setLedgerRows({});
    setUsage([]);
    try {
      const response = await apiFetch("/api/analyze?demo=1");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Demo failed");
      setData(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Demo failed");
    } finally {
      setLoading(false);
    }
  }

  const board = useMemo(() => {
    if (!data) return [];
    const merged = data.board.map((row) => (row.audit ? row : ledgerRows[row.wallet] ?? row));
    return Object.keys(ledgerRows).length > 0 ? merged.sort((a, b) => b.totalUsd - a.totalUsd) : merged;
  }, [data, ledgerRows]);
  const confidence = useMemo(() => ({
    high: board.filter((row) => row.audit?.confidence === "high").length,
    medium: board.filter((row) => row.audit?.confidence === "medium").length,
    low: board.filter((row) => row.audit?.confidence === "low").length,
  }), [board]);
  const leaders = board.slice(0, 30);
  const videoRow = board.find((row) => row.wallet === videoWallet);
  const busy = loading || auditing;

  return (
    <main>
      <header className="masthead">
        <a className="brand" href="https://data.birdeye.so" target="_blank" rel="noreferrer" aria-label="Birdeye Data">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logos/Birdeye_Data_Horizontal_Light.svg" alt="birdeye data" width={174} height={28} />
        </a>
        <span className="product">PnL Replayer</span>
        <span className={`status-pill ${needsKey ? "warn" : ""}`}>
          <i aria-hidden="true" />
          {apiKey.trim() ? "Solana · your API key" : serverKey ? "Solana · app API key" : serverKey === false ? "Solana · API key needed" : "Solana · Birdeye Data API"}
        </span>
      </header>

      <section className="hero">
        <div>
          <p className="kicker">Wallet PnL replay</p>
          <h1>Replay the trade.<br />Audit the PnL.</h1>
          <p className="hero-copy">Paste a Solana token. PnL Replayer ranks its traders with Birdeye Data, rebuilds any wallet&apos;s ledger from balance changes, and turns it into a shareable PnL video.</p>
          <EndpointRail />
        </div>
        <form onSubmit={analyze} className="mint-form">
          <label htmlFor="api-key" className="key-label">
            <Key size={14} weight="bold" aria-hidden="true" /> Birdeye Data API key
            {serverKey ? <small>optional</small> : null}
          </label>
          <Input
            id="api-key"
            ref={keyInputRef}
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setVisitorApiKey(event.target.value);
            }}
            placeholder={serverKey ? "Optional: use your own key instead of the app's" : "Paste your API key"}
            autoComplete="off"
            spellCheck={false}
            className="mint-input"
            aria-describedby="api-key-help"
          />
          <p id="api-key-help" className="form-help">
            Kept in this tab&apos;s memory only and sent to Birdeye through this app&apos;s server. Never stored or logged.{" "}
            <a href="https://data.birdeye.so" target="_blank" rel="noreferrer">Get a free key</a>
          </p>
          <label htmlFor="mint">Solana token mint</label>
          <div className="input-row">
            <Input
              id="mint"
              value={mint}
              onChange={(event) => setMint(event.target.value)}
              placeholder={SAMPLE_MINT}
              spellCheck={false}
              autoComplete="off"
              className="mint-input"
              required
            />
            <Button type="submit" size="lg" disabled={busy}>
              {loading ? "Loading board…" : auditing ? "Auditing…" : "Analyze"} <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </Button>
          </div>
          <p className="form-help">Base58 mint address, 32–44 characters. The board loads first; the leading wallet&apos;s ledger audit follows in the background.</p>
          <Button type="button" variant="link" className="demo-link" onClick={loadDemo} disabled={busy}>
            No API key? Try the sample dataset
          </Button>
          {error && <div className="form-error" role="alert">{error}</div>}
        </form>
      </section>

      {!data && !loading && (
        <section className="method-strip" aria-label="How it works">
          <div><b>01</b><span>Nominate</span><p>Six Top Traders rankings, unioned: winners, losers, volume and holders.</p></div>
          <div><b>02</b><span>Reconcile</span><p>Balance changes joined to decoded swaps by signature, priced at execution.</p></div>
          <div><b>03</b><span>Replay</span><p>A wallet-window video with every fill, graded by ledger confidence.</p></div>
        </section>
      )}

      {loading && (
        <section className="loading-grid" aria-live="polite" aria-label="Loading board">
          <div /><div /><div />
        </section>
      )}

      {data && (
        <>
          <section className="token-header">
            <div>
              <p className="token-symbol">${data.token.symbol ?? "TOKEN"}{data.demo ? <Badge variant="outline" className="pill neutral">Sample data</Badge> : null}</p>
              <h2>{data.token.name ?? short(data.token.mint)}</h2>
              <code>{data.token.mint}</code>
            </div>
            <div className="audit-counts" aria-label="Audited wallets by confidence">
              <div><strong>{confidence.high}</strong><span>High</span></div>
              <div><strong>{confidence.medium}</strong><span>Medium</span></div>
              <div><strong>{confidence.low}</strong><span>Low</span></div>
            </div>
          </section>
          {auditing && <div className="audit-progress" aria-live="polite">Board ready · auditing the leading wallet&apos;s ledger in the background…</div>}

          <PriceChart values={data.candles} />

          <section className="leaderboard">
            <div className="section-title">
              <h2>Trader board</h2>
              <p>Ranked by total PnL. A ledger replaces the Birdeye WAC row only when it can explain its inputs; opening a row&apos;s video builds that ledger.</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Wallet</th><th>Method</th><th className="number">Realized</th>
                    <th className="number">Unrealized</th><th className="number">Total PnL</th>
                    <th className="number">Δ vs WAC</th><th className="number">Trades</th><th className="clip-column"><span className="sr-only">Video</span></th>
                  </tr>
                </thead>
                <tbody>
                  {leaders.map((row, index) => (
                    <tr key={row.wallet}>
                      <td className="rank">{String(index + 1).padStart(2, "0")}</td>
                      <td className="wallet-cell"><code title={row.wallet}>{short(row.wallet)}</code>{row.tags?.slice(0, 2).map((tag) => <small key={tag}>{tag.replaceAll("_", " ")}</small>)}</td>
                      <td><Confidence level={row.audit?.confidence} holderOnly={row.buys + row.sells === 0} /></td>
                      <td className={`number ${row.realizedUsd < 0 ? "negative" : "positive"}`}>{money(row.realizedUsd, true)}</td>
                      <td className={`number ${row.unrealizedUsd < 0 ? "negative" : "positive"}`}>{money(row.unrealizedUsd, true)}</td>
                      <td className={`number total ${row.totalUsd < 0 ? "negative" : "positive"}`}>{money(row.totalUsd, true)}</td>
                      <td className="number delta">{row.audit ? money(row.audit.deltaUsd, true) : "N/A"}</td>
                      <td className="number">{(row.buys + row.sells).toLocaleString()}</td>
                      <td className="clip-column">
                        <Button type="button" variant="outline" size="sm" onClick={() => setVideoWallet(row.wallet)} aria-label={`Open PnL video for ${short(row.wallet)}`}>
                          <VideoCamera size={15} weight="bold" aria-hidden="true" /><span>Video</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <UsagePanel passes={usage} keySource={data.keySource} />
        </>
      )}
      <footer className="site-footer">
        <span>Data: Birdeye Data API · Top Traders, Wallet PnL, Balance Change, Token Transactions V3, OHLCV V3</span>
        <a href="https://data.birdeye.so" target="_blank" rel="noreferrer">Get a Birdeye Data API key</a>
      </footer>
      {data && videoRow && (
        <WalletVideoModal
          key={`${data.token.mint}:${videoRow.wallet}`}
          data={data}
          row={videoRow}
          onClose={() => setVideoWallet(null)}
          onLedger={(audited) => setLedgerRows((rows) => ({ ...rows, [audited.wallet]: audited }))}
        />
      )}
    </main>
  );
}
