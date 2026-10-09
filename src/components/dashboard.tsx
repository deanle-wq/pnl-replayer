"use client";

import { ArrowRight, CheckCircle, Coins, Key, ShieldCheck, VideoCamera, Wallet, WarningCircle } from "@phosphor-icons/react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiFetch, setVisitorApiKey } from "@/lib/api-client";
import {
  boardRowForToken,
  DEMO_WALLET,
  identityTags,
  mergeTokens,
  type WalletPortfolio,
  type WalletTokenRow,
} from "@/lib/wallet-portfolio";
import type { ApiUsage } from "@/server/birdeye/usage";
import type { BoardRow, TokenAnalysis } from "@/server/services/analyze-token";
import { money, MultiplePill, short, TokenAvatar, UsagePanel, WalletAvatar } from "./shared";
import { WalletVideoModal } from "./wallet-video-modal";
import { WalletView } from "./wallet-view";

const SAMPLE_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

/** The Birdeye Data endpoints this app is built on, shown as the hero's chip rail. */
const ENDPOINTS = [
  "Token - Top Traders",
  "Wallet - PnL (Multiple)",
  "Wallet - PnL Details",
  "Wallet - Portfolio",
  "Wallet Identity",
  "Wallet - Balance Change",
  "Trades - Token (V3)",
  "OHLCV V3",
  "Token - Metadata",
  "Token - Market Data",
  "Price",
];

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type Mode = "token" | "wallet";

/** Where a lookup lives in the address bar, so links can be shared and Back works. */
function readLocation(): { mode: Mode; value: string } | null {
  const params = new URLSearchParams(window.location.search);
  const wallet = params.get("wallet")?.trim();
  if (wallet && SOLANA_ADDRESS.test(wallet)) return { mode: "wallet", value: wallet };
  const mint = params.get("mint")?.trim();
  if (mint && SOLANA_ADDRESS.test(mint)) return { mode: "token", value: mint };
  return null;
}

function writeLocation(mode: Mode, value: string) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set(mode === "token" ? "mint" : "wallet", value);
  if (url.toString() !== window.location.href) window.history.pushState({ mode, value }, "", url);
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

export function Dashboard() {
  const [mode, setMode] = useState<Mode>("token");
  // Which result is on screen; the mode switch only changes the input.
  const [view, setView] = useState<Mode | null>(null);
  const [mint, setMint] = useState(SAMPLE_MINT);
  const [walletInput, setWalletInput] = useState("");
  const [data, setData] = useState<TokenAnalysis | null>(null);
  const [walletData, setWalletData] = useState<WalletPortfolio | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [videoWallet, setVideoWallet] = useState<string | null>(null);
  const [walletVideo, setWalletVideo] = useState<{ data: TokenAnalysis; row: BoardRow } | null>(null);
  const [openingMint, setOpeningMint] = useState<string | null>(null);
  const [usage, setUsage] = useState<Array<{ label: string; usage: ApiUsage }>>([]);
  const [walletUsage, setWalletUsage] = useState<Array<{ label: string; usage: ApiUsage }>>([]);
  // Ledgers built from the Video modal. Kept apart from `data` so the
  // background audit response cannot overwrite a row the user already audited.
  const [ledgerRows, setLedgerRows] = useState<Record<string, BoardRow>>({});
  // The visitor's own Birdeye key: React state and api-client memory only.
  const [apiKey, setApiKey] = useState("");
  const [serverKey, setServerKey] = useState<boolean | null>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  // Guards against a slow earlier lookup landing after a newer one.
  const requestRef = useRef(0);

  const needsKey = serverKey === false && apiKey.trim() === "";

  const requireKey = useCallback((): boolean => {
    if (!needsKey) return true;
    setError("Add your Birdeye Data API key first. It stays in this tab's memory only.");
    keyInputRef.current?.focus();
    return false;
  }, [needsKey]);

  const scrollToResults = () => {
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const loadToken = useCallback(async (target: string, options: { push?: boolean; demo?: boolean } = {}) => {
    const value = target.trim();
    setError("");
    setMode("token");
    setMint(value || SAMPLE_MINT);
    if (!options.demo && !SOLANA_ADDRESS.test(value)) {
      setError("Paste a Solana token mint: base58, 32–44 characters.");
      return;
    }
    if (!options.demo && !requireKey()) return;
    const request = ++requestRef.current;
    setLoading(true);
    setAuditing(false);
    setLedgerRows({});
    setUsage([]);
    setVideoWallet(null);
    try {
      const encodedMint = encodeURIComponent(value);
      const response = await apiFetch(options.demo ? `/api/analyze?demo=1&mint=${encodedMint}` : `/api/analyze?mint=${encodedMint}&audit=0`);
      const body = await response.json();
      if (!response.ok) {
        if (body.code?.startsWith("api_key")) keyInputRef.current?.focus();
        throw new Error(body.error ?? "Analysis failed");
      }
      if (request !== requestRef.current) return;
      setData(body);
      setView("token");
      if (!options.demo && options.push !== false) writeLocation("token", value);
      if (body.usage) setUsage([{ label: "Board", usage: body.usage }]);
      setLoading(false);
      scrollToResults();
      if (options.demo) return;

      setAuditing(true);
      const auditResponse = await apiFetch(`/api/analyze?mint=${encodedMint}&audit=1`);
      const auditedBody = await auditResponse.json();
      if (!auditResponse.ok) throw new Error(auditedBody.error ?? "Deep audit failed");
      if (request !== requestRef.current) return;
      setData(auditedBody);
      if (auditedBody.usage) setUsage((passes) => [...passes, { label: "Leading-wallet audit", usage: auditedBody.usage }]);
    } catch (caught) {
      if (request === requestRef.current) setError(caught instanceof Error ? caught.message : "Analysis failed");
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
        setAuditing(false);
      }
    }
  }, [requireKey]);

  const loadWallet = useCallback(async (target: string, options: { push?: boolean; demo?: boolean } = {}) => {
    const value = target.trim();
    setError("");
    setMode("wallet");
    setWalletInput(value);
    if (!options.demo && !SOLANA_ADDRESS.test(value)) {
      setError("Paste a Solana wallet address: base58, 32–44 characters.");
      return;
    }
    if (!options.demo && !requireKey()) return;
    const request = ++requestRef.current;
    setLoading(true);
    setAuditing(false);
    setWalletUsage([]);
    setWalletVideo(null);
    try {
      const response = await apiFetch(options.demo ? "/api/wallet?demo=1" : `/api/wallet?wallet=${encodeURIComponent(value)}`);
      const body = await response.json();
      if (!response.ok) {
        if (body.code?.startsWith("api_key")) keyInputRef.current?.focus();
        throw new Error(body.error ?? "Wallet lookup failed");
      }
      if (request !== requestRef.current) return;
      setWalletData(body);
      setWalletInput(body.wallet);
      setView("wallet");
      if (!options.demo && options.push !== false) writeLocation("wallet", value);
      if (body.usage) setWalletUsage([{ label: "Wallet", usage: body.usage }]);
      scrollToResults();
    } catch (caught) {
      if (request === requestRef.current) setError(caught instanceof Error ? caught.message : "Wallet lookup failed");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [requireKey]);

  // Learn whether the deployment has a key, then open what the address bar
  // asks for. Back and Forward between lookups are handled below.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void fetch("/api/health", { cache: "no-store" })
      .then((response) => response.json())
      .then((health) => {
        const configured = Boolean(health.configured);
        setServerKey(configured);
        const target = readLocation();
        if (!target) return;
        if (target.mode === "wallet") setWalletInput(target.value);
        else setMint(target.value);
        setMode(target.mode);
        if (!configured) {
          setError("Add your Birdeye Data API key, then press the button to open this link.");
          return;
        }
        void (target.mode === "wallet" ? loadWallet(target.value, { push: false }) : loadToken(target.value, { push: false }));
      })
      .catch(() => setServerKey(false));
  }, [loadToken, loadWallet]);

  useEffect(() => {
    const onPop = () => {
      const target = readLocation();
      if (!target) {
        setView(null);
        return;
      }
      void (target.mode === "wallet" ? loadWallet(target.value, { push: false }) : loadToken(target.value, { push: false }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [loadToken, loadWallet]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void (mode === "token" ? loadToken(mint) : loadWallet(walletInput));
  }

  function loadDemo() {
    void (mode === "token" ? loadToken(SAMPLE_MINT, { demo: true }) : loadWallet(DEMO_WALLET, { demo: true }));
  }

  async function loadMoreTokens() {
    if (!walletData || walletData.nextOffset === null || walletData.demo) return;
    setLoadingMore(true);
    try {
      const response = await apiFetch(`/api/wallet?wallet=${encodeURIComponent(walletData.wallet)}&offset=${walletData.nextOffset}`);
      const body = (await response.json()) as WalletPortfolio & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load more tokens");
      setWalletData((current) => current && current.wallet === body.wallet
        ? { ...current, tokens: mergeTokens(current.tokens, body.tokens), hiddenQuoteAssets: current.hiddenQuoteAssets + body.hiddenQuoteAssets, nextOffset: body.nextOffset }
        : current);
      if (body.usage) setWalletUsage((passes) => [...passes, { label: `Tokens from ${walletData.nextOffset}`, usage: body.usage! }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load more tokens");
    } finally {
      setLoadingMore(false);
    }
  }

  async function openWalletVideo(token: WalletTokenRow) {
    if (!walletData) return;
    if (!walletData.demo && !requireKey()) return;
    setError("");
    setOpeningMint(token.mint);
    try {
      const encodedMint = encodeURIComponent(token.mint);
      const response = await apiFetch(walletData.demo ? `/api/token?demo=1&mint=${encodedMint}` : `/api/token?mint=${encodedMint}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load this token's chart");
      const context = body as TokenAnalysis;
      const tags = identityTags(walletData.identity);
      // The sample board carries an audited row for the sample wallet.
      const sample = context.board.find((entry) => entry.wallet === walletData.wallet);
      const row = sample ?? boardRowForToken(walletData.wallet, token, tags);
      setWalletVideo({ data: context, row: { ...row, tags: row.tags.length > 0 ? row.tags : tags } });
      if (context.usage) setWalletUsage((passes) => [...passes, { label: `$${token.symbol} chart`, usage: context.usage! }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this token's chart");
    } finally {
      setOpeningMint(null);
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
  // In the sample, only the sample wallet has a wallet page.
  const canOpenWallet = (wallet: string) => !data?.demo || wallet === DEMO_WALLET;

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
          <p className="hero-copy">
            {mode === "token"
              ? "Paste a Solana token. PnL Replayer ranks its traders with Birdeye Data, rebuilds any wallet's ledger from balance changes, and turns it into a shareable PnL video."
              : "Paste a Solana wallet. PnL Replayer lists every token it traded or holds with Birdeye Wallet PnL, and replays any of them as a shareable PnL video."}
          </p>
          <EndpointRail />
        </div>
        <form onSubmit={submit} className="mint-form">
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
          <ToggleGroup
            type="single"
            variant="outline"
            aria-label="Look up a token or a wallet"
            value={mode}
            onValueChange={(next) => {
              if (next) {
                setMode(next as Mode);
                setError("");
              }
            }}
            className="segmented-group mode-switch"
          >
            <ToggleGroupItem value="token"><Coins size={15} aria-hidden="true" />Token</ToggleGroupItem>
            <ToggleGroupItem value="wallet"><Wallet size={15} aria-hidden="true" />Wallet</ToggleGroupItem>
          </ToggleGroup>
          <label htmlFor="lookup">{mode === "token" ? "Solana token mint" : "Solana wallet address"}</label>
          <div className="input-row">
            <Input
              id="lookup"
              value={mode === "token" ? mint : walletInput}
              onChange={(event) => (mode === "token" ? setMint(event.target.value) : setWalletInput(event.target.value))}
              placeholder={mode === "token" ? SAMPLE_MINT : "Wallet address, e.g. from a trader board row"}
              spellCheck={false}
              autoComplete="off"
              className="mint-input"
              required
            />
            <Button type="submit" size="lg" disabled={busy}>
              {loading ? (mode === "token" ? "Loading board…" : "Loading wallet…") : auditing ? "Auditing…" : mode === "token" ? "Analyze" : "Open wallet"} <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </Button>
          </div>
          <p className="form-help">
            {mode === "token"
              ? "Base58 mint address, 32–44 characters. The board loads first; the leading wallet's ledger audit follows in the background."
              : "Base58 wallet address. Tokens load newest trade first, 100 at a time; quote assets like SOL and USDC are left out."}
          </p>
          <Button type="button" variant="link" className="demo-link" onClick={loadDemo} disabled={busy}>
            No API key? Try the sample {mode === "token" ? "token" : "wallet"}
          </Button>
          {error && <div className="form-error" role="alert">{error}</div>}
        </form>
      </section>

      {!view && !loading && (
        <section className="method-strip" aria-label="How it works">
          <div><b>01</b><span>Nominate</span><p>Six Top Traders rankings, unioned: winners, losers, volume and holders. Or start from one wallet.</p></div>
          <div><b>02</b><span>Reconcile</span><p>Balance changes joined to decoded swaps by signature, priced at execution.</p></div>
          <div><b>03</b><span>Replay</span><p>A wallet-window video with every fill, graded by ledger confidence.</p></div>
        </section>
      )}

      {loading && (
        <section className="loading-grid" aria-live="polite" aria-label={mode === "token" ? "Loading board" : "Loading wallet"}>
          <div /><div /><div />
        </section>
      )}

      <div ref={resultsRef} className="results-anchor" />

      {view === "wallet" && walletData && !loading && (
        <>
          <nav className="view-crumbs" aria-label="Current view">
            <span><Wallet size={14} aria-hidden="true" /> Wallet</span>
            {data && (
              <Button type="button" variant="link" onClick={() => setView("token")}>
                Back to ${data.token.symbol ?? "token"} board
              </Button>
            )}
          </nav>
          <WalletView
            portfolio={walletData}
            loadingMore={loadingMore}
            openingMint={openingMint}
            onLoadMore={() => void loadMoreTokens()}
            onVideo={(token) => void openWalletVideo(token)}
            onTokenBoard={(tokenMint) => void loadToken(tokenMint, { demo: walletData.demo })}
          />
          <UsagePanel passes={walletUsage} keySource={walletData.keySource} />
        </>
      )}

      {view === "token" && data && !loading && (
        <>
          {walletData && (
            <nav className="view-crumbs" aria-label="Current view">
              <span><Coins size={14} aria-hidden="true" /> Token</span>
              <Button type="button" variant="link" onClick={() => setView("wallet")}>
                Back to wallet {walletData.identity?.label ?? short(walletData.wallet)}
              </Button>
            </nav>
          )}
          <section className="token-header">
            <div className="token-identity">
              <TokenAvatar key={data.token.logo ?? data.token.mint} src={data.token.logo} symbol={data.token.symbol ?? "TOKEN"} />
              <div>
                <p className="token-symbol">${data.token.symbol ?? "TOKEN"}{data.demo ? <Badge variant="outline" className="pill neutral">Sample data</Badge> : null}</p>
                <h2>{data.token.name ?? short(data.token.mint)}</h2>
                {data.market && data.market.marketCapUsd > 0 && (
                  <p className="token-market">
                    MC {money(data.market.marketCapUsd)}
                    {data.market.holders > 0 ? ` · ${data.market.holders.toLocaleString("en-US")} holders` : ""}
                  </p>
                )}
                <code>{data.token.mint}</code>
              </div>
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
              <p>Ranked by total PnL. A ledger replaces the Birdeye WAC row only when it can explain its inputs; opening a row&apos;s video builds that ledger. Click a wallet to see every token it traded.</p>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Wallet</th><th>Method</th><th className="number">Invested</th><th className="number">Realized</th>
                    <th className="number">Unrealized</th><th className="number">Total PnL</th>
                    <th className="number">Δ vs WAC</th><th className="number">Trades</th><th className="clip-column"><span className="sr-only">Video</span></th>
                  </tr>
                </thead>
                <tbody>
                  {leaders.map((row, index) => (
                    <tr key={row.wallet}>
                      <td className="rank">{String(index + 1).padStart(2, "0")}</td>
                      <td className="wallet-cell">
                        {canOpenWallet(row.wallet) ? (
                          <button
                            type="button"
                            className="wallet-link"
                            onClick={() => void loadWallet(row.wallet, { demo: data.demo })}
                            title="Open this wallet: every token it traded"
                            aria-label={`Open wallet ${short(row.wallet)}`}
                          >
                            <WalletAvatar wallet={row.wallet} size={18} />
                            <code>{short(row.wallet)}</code>
                          </button>
                        ) : (
                          <code title={row.wallet}>{short(row.wallet)}</code>
                        )}
                        {row.tags?.slice(0, 2).map((tag) => <small key={tag}>{tag.replaceAll("_", " ")}</small>)}
                      </td>
                      <td><Confidence level={row.audit?.confidence} holderOnly={row.buys + row.sells === 0} /></td>
                      <td className="number">{row.boughtUsd > 0 ? money(row.boughtUsd) : "N/A"}</td>
                      <td className={`number ${row.realizedUsd < 0 ? "negative" : "positive"}`}>{money(row.realizedUsd, true)}</td>
                      <td className={`number ${row.unrealizedUsd < 0 ? "negative" : "positive"}`}>{money(row.unrealizedUsd, true)}</td>
                      <td className={`number total ${row.totalUsd < 0 ? "negative" : "positive"}`}>
                        {money(row.totalUsd, true)}
                        <MultiplePill investedUsd={row.boughtUsd} totalUsd={row.totalUsd} />
                      </td>
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
        <span>Data: Birdeye Data API · Top Traders, Wallet PnL, Wallet PnL Details, Portfolio, Balance Change, Token Transactions V3, OHLCV V3</span>
        <a href="https://data.birdeye.so" target="_blank" rel="noreferrer">Get a Birdeye Data API key</a>
      </footer>
      {view === "token" && data && videoRow && (
        <WalletVideoModal
          key={`${data.token.mint}:${videoRow.wallet}`}
          data={data}
          row={videoRow}
          onClose={() => setVideoWallet(null)}
          onLedger={(audited) => setLedgerRows((rows) => ({ ...rows, [audited.wallet]: audited }))}
        />
      )}
      {view === "wallet" && walletVideo && (
        <WalletVideoModal
          key={`${walletVideo.data.token.mint}:${walletVideo.row.wallet}`}
          data={walletVideo.data}
          row={walletVideo.row}
          onClose={() => setWalletVideo(null)}
        />
      )}
    </main>
  );
}
