"use client";

import {
  ChartLineUp,
  DownloadSimple,
  FilmStrip,
  Pause,
  Play,
  Sparkle,
  SpeakerHigh,
  SpeakerSlash,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiFetch } from "@/lib/api-client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  candleIndexAtOrBefore,
  coarsenCandles,
  expectedCandleCount,
  isReplayTimeframe,
  MAX_REPLAY_CANDLES,
  REPLAY_TIMEFRAMES,
  TIMEFRAME_SECONDS,
  type ReplayTimeframe,
} from "@/lib/replay-timeframe";
import {
  binEvents,
  defaultWalletTimeframe,
  PAD_BARS,
  walletActivity,
  walletReplayWindow,
  type ReplayRange,
} from "@/lib/replay-window";
import { DEFAULT_SOUND, LiveCuePlayer, loadSamples, renderSoundtrack, type SoundSettings } from "@/lib/video-audio";
import { drawMessage, drawVideoFrame, type VideoScene } from "@/lib/video-frame";
import { barTime, cueSchedule, fillBursts, videoTimeline } from "@/lib/video-scene";
import {
  downloadVideo,
  encodeWalletVideo,
  findVideoEncoder,
  MAX_VIDEO_SECONDS,
  MIN_VIDEO_SECONDS,
  VIDEO_FORMATS,
  type VideoEncoderChoice,
  type VideoShape,
} from "@/lib/wallet-video";
import { walletVideoMetrics, type QuoteUnit } from "@/lib/wallet-video-metrics";
import type { BirdeyeCandle } from "@/server/birdeye/types";
import type { ApiUsage } from "@/server/birdeye/usage";
import type { LedgerEvent } from "@/server/pnl/ledger";
import type { BoardRow, TokenAnalysis } from "@/server/services/analyze-token";
import type { WalletReplay } from "@/server/services/wallet-replay";

const CLIP_DURATIONS = [6, 10, 15, 30, 60, 120, 300] as const;
const LOGO_SRC = "/brand/logos/Birdeye_Data_Horizontal_Light.svg";
const NO_EVENTS: LedgerEvent[] = [];

// One ledger request per wallet at a time. React's development double-mount
// would otherwise abort the first fetch and let the second ride its server
// cache, reporting zero CU for work that did happen.
const replayRequests = new Map<string, Promise<WalletReplay>>();

function requestReplay(params: URLSearchParams): Promise<WalletReplay> {
  const key = params.toString();
  const held = replayRequests.get(key);
  if (held) return held;
  const request = apiFetch(`/api/replay?${params}`)
    .then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Wallet ledger failed");
      return body as WalletReplay;
    })
    .finally(() => setTimeout(() => replayRequests.delete(key), 1_000));
  replayRequests.set(key, request);
  return request;
}

function compactUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}

function walletLabel(wallet: string): string {
  return `${wallet.slice(0, 6)}…${wallet.slice(-6)}`;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function day(timestamp: number): string {
  return new Date(timestamp * 1_000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

type ReplayRangeKind = "wallet" | "token";

/** What the clip replays: an audited ledger, or Birdeye WAC totals with a trade path. */
interface ReplayView {
  mode: "audited" | "truncated" | "sample" | "summary";
  row: BoardRow;
  events: LedgerEvent[];
  note?: string;
}

interface CandleSeries extends ReplayRange {
  key: string;
  range: ReplayRangeKind;
  timeframe: ReplayTimeframe;
  candles: BirdeyeCandle[];
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
  render,
  isDisabled,
}: {
  label: string;
  options: readonly T[];
  /** Null when the current value is a custom one outside the presets. */
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  render?: (value: T) => string;
  isDisabled?: (value: T) => boolean;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={label}
      value={value ?? ""}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      disabled={disabled}
      className="segmented-group w-full"
    >
      {options.map((option) => (
        <ToggleGroupItem key={option} value={option} disabled={isDisabled?.(option)} className="flex-1">
          {render ? render(option) : option}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function SwitchField({ id, label, checked, onChange, disabled }: { id: string; label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div className="switch-field">
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}

function UsageLine({ usage, elapsedMs }: { usage?: ApiUsage; elapsedMs?: number }) {
  if (!usage) return null;
  return (
    <span className="usage-line">
      {usage.requests.toLocaleString()} Birdeye requests · {usage.cu.toLocaleString()} CU
      {usage.cacheHits > 0 ? ` · ${usage.cacheHits} cached` : ""}
      {elapsedMs !== undefined ? ` · ${(elapsedMs / 1_000).toFixed(1)}s` : ""}
    </span>
  );
}

export function WalletVideoModal({
  data,
  row,
  onClose,
  onLedger,
}: {
  data: TokenAnalysis;
  row: BoardRow;
  onClose: () => void;
  /** Receives the audited row once a full, untruncated ledger is built for a WAC row. */
  onLedger?: (row: BoardRow) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // State mirror of the canvas ref, so the first paint waits for the portal to mount.
  const [canvasNode, setCanvasNode] = useState<HTMLCanvasElement | null>(null);
  const attachCanvas = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    setCanvasNode(node);
  }, []);
  const animationRef = useRef<number | null>(null);
  const startedRef = useRef(0);
  const playheadRef = useRef(0);
  const audioRef = useRef<LiveCuePlayer | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const onLedgerRef = useRef(onLedger);
  useEffect(() => {
    onLedgerRef.current = onLedger;
  }, [onLedger]);
  // The Birdeye WAC row as it stood when the clip was opened. Tags and Top
  // Traders timestamps live here; the ledger response does not carry them.
  const [baseRow] = useState(row);
  const baseTimeframe: ReplayTimeframe = isReplayTimeframe(data.candles[0]?.type) ? data.candles[0].type : "1H";
  const tokenRange = useMemo<ReplayRange>(
    () => ({ from: data.candles[0]?.unixTime ?? data.generatedAt, to: data.generatedAt }),
    [data],
  );
  // Top Traders' first/last trade times are not scoped to this token (a BONK
  // wallet reported a first trade months before BONK existed). Keep the hints
  // inside the token's own chart before using them for anything.
  const hints = useMemo(() => {
    const clamp = (value?: number) => value ? Math.min(tokenRange.to, Math.max(tokenRange.from, value)) : undefined;
    return { first: clamp(baseRow.firstTradeAt), last: clamp(baseRow.lastTradeAt) };
  }, [baseRow, tokenRange]);

  const [fetched, setFetched] = useState<ReplayView | null>(null);
  const [replayError, setReplayError] = useState("");
  const [replayStats, setReplayStats] = useState<{ usage: ApiUsage; elapsedMs: number } | null>(null);
  const hasAudit = Boolean(row.audit);
  const needsLedger = !hasAudit && !data.demo;
  const replay = useMemo<ReplayView | null>(() => {
    if (row.audit) return { mode: "audited", row, events: row.audit.ledger.events };
    if (fetched) return fetched;
    if (!needsLedger || replayError) return { mode: "summary", row, events: NO_EVENTS };
    return null;
  }, [fetched, needsLedger, replayError, row]);
  const replayLoading = replay === null;

  useEffect(() => {
    if (hasAudit || data.demo) return;
    let cancelled = false;
    const params = new URLSearchParams({ mint: data.token.mint, wallet: baseRow.wallet });
    if (hints.first) params.set("first", String(hints.first));
    if (hints.last) params.set("last", String(hints.last));
    void requestReplay(params)
      .then((result) => {
        if (cancelled) return;
        setReplayStats({ usage: result.usage, elapsedMs: result.elapsedMs });
        if (result.mode === "ledger" && result.row.audit && !result.row.audit.truncated) {
          const audited: BoardRow = {
            ...result.row,
            tags: baseRow.tags,
            firstTradeAt: baseRow.firstTradeAt,
            lastTradeAt: baseRow.lastTradeAt,
          };
          setFetched({ mode: "audited", row: audited, events: result.row.audit.ledger.events });
          onLedgerRef.current?.(audited);
        } else if (result.mode === "ledger") {
          setFetched({
            mode: "truncated",
            row: baseRow,
            events: result.row.audit?.ledger.events ?? [],
            note: "The full ledger reached the event ceiling, so PnL follows Birdeye WAC. Markers use every event that was read.",
          });
        } else {
          setFetched({
            mode: "sample",
            row: baseRow,
            events: result.events,
            note: `${result.reason}. Markers come from ${result.sampled ? "a sample of " : ""}buy and sell pages read separately across ${result.windows} windows of this wallet's span; PnL lands on Birdeye WAC.`,
          });
        }
      })
      .catch((caught) => {
        if (cancelled) return;
        setReplayError(caught instanceof Error ? caught.message : "Wallet ledger failed");
      });
    return () => {
      cancelled = true;
    };
  }, [baseRow, data.demo, data.token.mint, hasAudit, hints]);

  const events = replay?.events ?? NO_EVENTS;
  const replayRow = replay?.row ?? row;
  const activity = useMemo(
    () => replay
      ? walletActivity({
        events: replay.events,
        holding: replay.row.holding,
        firstTradeAt: hints.first,
        lastTradeAt: hints.last,
        widenToHints: replay.mode === "sample",
      })
      : null,
    [hints, replay],
  );

  const [rangeKind, setRangeKind] = useState<ReplayRangeKind>("wallet");
  const effectiveRange: ReplayRangeKind = activity ? rangeKind : "token";
  const [timeframeChoice, setTimeframeChoice] = useState<ReplayTimeframe | null>(null);
  const defaultTimeframe = useMemo<ReplayTimeframe>(() => {
    if (effectiveRange === "token" || !activity) return baseTimeframe;
    const preferred = defaultWalletTimeframe(activity, data.generatedAt);
    // Demo candles are hourly: they can be widened locally but not refined.
    return data.demo && TIMEFRAME_SECONDS[preferred] < TIMEFRAME_SECONDS[baseTimeframe] ? baseTimeframe : preferred;
  }, [activity, baseTimeframe, data.demo, data.generatedAt, effectiveRange]);
  const timeframe = timeframeChoice ?? defaultTimeframe;
  const windowFor = useCallback(
    (kind: ReplayRangeKind, option: ReplayTimeframe): ReplayRange =>
      kind === "wallet" && activity ? walletReplayWindow(activity, option, data.generatedAt) : tokenRange,
    [activity, data.generatedAt, tokenRange],
  );
  const requestedKey = replay ? `${effectiveRange}:${timeframe}` : null;

  const [series, setSeries] = useState<CandleSeries | null>(null);
  const candleCacheRef = useRef(new Map<string, CandleSeries>());
  const changeMomentRef = useRef<{ timestamp: number; progress: number } | null>(null);
  const resumeAfterLoadRef = useRef(true);
  const [timeframeLoading, setTimeframeLoading] = useState(false);
  const [timeframeError, setTimeframeError] = useState("");
  const [shape, setShape] = useState<VideoShape>("portrait");
  const [clipSeconds, setClipSeconds] = useState<number>(15);
  const [durationDraft, setDurationDraft] = useState("15");
  const [holdSeconds, setHoldSeconds] = useState(1.1);
  const [quoteUnit, setQuoteUnit] = useState<QuoteUnit>("USDC");
  const [effectsOn, setEffectsOn] = useState(true);
  const [markersOn, setMarkersOn] = useState(true);
  const [sound, setSound] = useState<SoundSettings>(DEFAULT_SOUND);
  const [looping, setLooping] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [encoder, setEncoder] = useState<VideoEncoderChoice | null | "probing">("probing");
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<{ url: string; name: string } | null>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const timeline = useMemo(() => videoTimeline(clipSeconds), [clipSeconds]);

  useEffect(() => {
    const image = new Image();
    image.onload = () => setLogo(image);
    image.src = LOGO_SRC;
    let cancelled = false;
    void Promise.all(["500", "600", "700", "800"].map((weight) => document.fonts.load(`${weight} 48px Geist`)))
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) setFontsReady(true);
      });
    return () => {
      cancelled = true;
      image.onload = null;
    };
  }, []);

  // One audio context for the editor's life, opened as soon as it mounts:
  // the click that opened the editor already counts as a user gesture.
  const [audioRunning, setAudioRunning] = useState(false);
  useEffect(() => {
    const player = new LiveCuePlayer(setAudioRunning);
    audioRef.current = player;
    player.unlock();
    return () => {
      player.close();
      if (audioRef.current === player) audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!requestedKey || series?.key === requestedKey) return;
    let cancelled = false;
    const controller = new AbortController();
    const range = windowFor(effectiveRange, timeframe);
    const activate = (candles: BirdeyeCandle[]) => {
      if (cancelled) return;
      if (candles.length < 2) throw new Error(`Birdeye returned too few ${timeframe} candles for this range.`);
      const next: CandleSeries = { key: requestedKey, range: effectiveRange, timeframe, ...range, candles };
      candleCacheRef.current.set(requestedKey, next);
      const moment = changeMomentRef.current;
      changeMomentRef.current = null;
      const index = moment ? candleIndexAtOrBefore(candles, moment.timestamp) : 0;
      const replayShare = timeline.replaySeconds / timeline.clipSeconds;
      const progress = moment && moment.progress >= replayShare
        ? moment.progress
        : barTime(Math.max(index, 0), candles.length, timeline.replaySeconds) / timeline.clipSeconds;
      playheadRef.current = progress;
      setPlayhead(progress);
      setSeries(next);
      setTimeframeError("");
      setPlaying(resumeAfterLoadRef.current);
    };

    void (async () => {
      setTimeframeLoading(true);
      try {
        const cached = candleCacheRef.current.get(requestedKey);
        if (cached) {
          activate(cached.candles);
          return;
        }
        const seconds = TIMEFRAME_SECONDS[timeframe];
        if (data.demo || (effectiveRange === "token" && timeframe === baseTimeframe)) {
          const source = timeframe === baseTimeframe ? data.candles : coarsenCandles(data.candles, timeframe);
          activate(source.filter((candle) => candle.unixTime + seconds > range.from && candle.unixTime <= range.to));
          return;
        }
        const params = new URLSearchParams({
          mint: data.token.mint,
          from: String(range.from),
          to: String(range.to),
          timeframe,
        });
        const response = await apiFetch(`/api/ohlcv?${params}`, { signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "OHLCV request failed.");
        activate(body.candles ?? []);
      } catch (caught) {
        if (cancelled || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setTimeframeError(caught instanceof Error ? caught.message : "OHLCV request failed.");
        // Keep whatever was already showing; on a first load fall back to
        // the token chart, which is always available.
        if (series) {
          setRangeKind(series.range);
          setTimeframeChoice(series.timeframe);
        } else if (effectiveRange === "wallet") {
          setRangeKind("token");
          setTimeframeChoice(null);
        }
        setPlaying(resumeAfterLoadRef.current);
      } finally {
        if (!cancelled) setTimeframeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [baseTimeframe, data, effectiveRange, requestedKey, series, timeframe, timeline, windowFor]);

  const bins = useMemo(
    () => binEvents(events, series?.candles ?? [], series?.timeframe ?? timeframe, series ?? undefined),
    [events, series, timeframe],
  );
  const bursts = useMemo(
    () => fillBursts(bins, series?.candles.length ?? 0, timeline.replaySeconds),
    [bins, series, timeline.replaySeconds],
  );

  // PnL sampled on fill bars plus a coarse grid: enough to place milestone
  // fanfares and draw the result curve without running the ledger per candle.
  const pnlPath = useMemo(() => {
    const candles = series?.candles ?? [];
    if (candles.length < 2) return [];
    const sampleBars = new Set<number>(bins.fills.keys());
    const stride = Math.max(1, Math.floor(candles.length / 60));
    for (let bar = 0; bar < candles.length; bar += stride) sampleBars.add(bar);
    const pnl = [...sampleBars].filter((bar) => bar >= 0 && bar < candles.length).sort((a, b) => a - b).map((bar) => {
      const reveal = bar / (candles.length - 1);
      const currentEvents = events.filter((_, index) => (bins.bars[index] ?? -1) <= bar);
      const metrics = walletVideoMetrics({
        row: replayRow,
        events,
        currentEvents,
        currentPrice: candles[bar]!.c,
        finalPrice: candles.at(-1)!.c,
        reveal: Math.min(reveal, 0.9998),
      });
      return { t: barTime(bar, candles.length, timeline.replaySeconds), totalUsd: metrics.totalUsd };
    });
    return pnl;
  }, [bins, events, replayRow, series, timeline.replaySeconds]);
  const cues = useMemo(
    () => (pnlPath.length > 0 ? cueSchedule({ bursts, pnl: pnlPath, timeline, finalTotalUsd: replayRow.totalUsd, pack: sound.pack }) : []),
    [bursts, pnlPath, replayRow.totalUsd, sound.pack, timeline],
  );
  // Decode the meme samples ahead of the first play so the preview has them.
  useEffect(() => {
    if (sound.pack === "meme") void loadSamples();
  }, [sound.pack]);

  const basis = replay?.mode === "audited" && replayRow.audit
    ? `Ledger PnL · ${replayRow.audit.confidence} confidence`
    : replay?.mode === "summary" ? "Birdeye WAC summary" : "Estimated PnL path · Birdeye WAC totals";
  const scene = useMemo<VideoScene | null>(() => series ? {
    shape,
    symbol: data.token.symbol ?? "TOKEN",
    wallet: row.wallet,
    solPriceUsd: data.solPriceUsd,
    candles: series.candles,
    timeframe: series.timeframe,
    row: replayRow,
    events,
    bins,
    bursts,
    timeline,
    holdSeconds,
    unit: quoteUnit,
    effects: effectsOn,
    markers: markersOn,
    basis,
    logo,
    pnlPath,
  } : null, [basis, bins, bursts, data.solPriceUsd, data.token.symbol, effectsOn, events, holdSeconds, logo, markersOn, pnlPath, quoteUnit, replayRow, row.wallet, series, shape, timeline]);

  useEffect(() => {
    void findVideoEncoder().then(setEncoder);
  }, []);

  useEffect(() => () => {
    if (generated) URL.revokeObjectURL(generated.url);
  }, [generated]);

  const paintPreview = useCallback((progress: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    if (!scene) {
      drawMessage(ctx, replayLoading ? "Building wallet ledger…" : "Loading candles…");
      return;
    }
    drawVideoFrame(ctx, progress * timeline.clipSeconds, scene);
  }, [replayLoading, scene, timeline.clipSeconds]);

  useEffect(() => {
    paintPreview(playhead);
  }, [canvasNode, shape, paintPreview, playhead, fontsReady]);

  useEffect(() => {
    if (!playing || rendering || timeframeLoading || !scene) return;
    startedRef.current = performance.now() - playheadRef.current * clipSeconds * 1_000;
    let previous = playheadRef.current * clipSeconds;
    const tick = (now: number) => {
      const elapsed = (now - startedRef.current) / (clipSeconds * 1_000);
      const next = looping ? elapsed % 1 : Math.min(elapsed, 1);
      const seconds = next * clipSeconds;
      audioRef.current?.play(cues, previous, seconds, sound);
      previous = seconds;
      playheadRef.current = next;
      setPlayhead(next);
      if (!looping && elapsed >= 1) {
        setPlaying(false);
        return;
      }
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, [clipSeconds, cues, looping, playing, rendering, scene, sound, timeframeLoading]);

  const togglePlay = () => {
    audioRef.current?.unlock();
    if (!playing && playheadRef.current >= 0.999) {
      playheadRef.current = 0;
      setPlayhead(0);
    }
    setPlaying((value) => !value);
  };

  const exportVideo = async () => {
    if (!encoder || encoder === "probing" || !scene) return;
    setError("");
    setPlaying(false);
    setRendering(true);
    setRenderProgress(0);
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      const audio = encoder.audio && sound.enabled ? await renderSoundtrack(cues, clipSeconds, sound) : null;
      const blob = await encodeWalletVideo({
        shape,
        encoder,
        seconds: clipSeconds,
        audio,
        draw: (ctx, seconds) => drawVideoFrame(ctx, seconds, scene),
        onProgress: setRenderProgress,
        signal: controller.signal,
      });
      const name = `pnl-replayer-${data.token.symbol ?? "token"}-${row.wallet.slice(0, 8)}-${scene.timeframe}-${clipSeconds}s-${VIDEO_FORMATS[shape].label.replace(":", "x")}.${encoder.ext}`;
      const url = URL.createObjectURL(blob);
      setGenerated({ url, name });
      downloadVideo(blob, name);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(caught instanceof Error ? caught.message : "Video export failed");
      }
    } finally {
      exportAbortRef.current = null;
      setRendering(false);
    }
  };

  const shapeOptions = useMemo(() => Object.keys(VIDEO_FORMATS) as VideoShape[], []);
  const fills = events.filter((event) => event.kind === "buy" || event.kind === "sell").length;
  const applyDuration = (seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const next = Math.max(MIN_VIDEO_SECONDS, Math.min(MAX_VIDEO_SECONDS, Math.round(seconds)));
    setClipSeconds(next);
    setDurationDraft(String(next));
    setGenerated(null);
  };
  const commitDurationDraft = () => {
    const parsed = Number(durationDraft);
    applyDuration(durationDraft.trim() === "" || !Number.isFinite(parsed) ? clipSeconds : parsed);
  };
  // Hold the playhead on the same moment while the chart is swapped.
  const rememberMoment = () => {
    if (series) {
      const reveal = Math.min(1, (playheadRef.current * timeline.clipSeconds) / timeline.replaySeconds);
      const index = Math.floor(reveal * Math.max(series.candles.length - 1, 0));
      changeMomentRef.current = { timestamp: series.candles[Math.max(index, 0)]?.unixTime ?? series.from, progress: playheadRef.current };
    }
    if (!timeframeLoading) resumeAfterLoadRef.current = playing;
    setPlaying(false);
    setTimeframeError("");
    setGenerated(null);
  };
  const chooseTimeframe = (next: ReplayTimeframe) => {
    if (next === timeframe) return;
    rememberMoment();
    setTimeframeChoice(next);
  };
  const chooseRange = (next: ReplayRangeKind) => {
    if (next === effectiveRange) return;
    rememberMoment();
    setRangeKind(next);
    setTimeframeChoice(null);
  };
  const changed = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setGenerated(null);
  };

  const audit = replayRow.audit;
  const modeLabel = replay?.mode === "audited"
    ? `Audited ledger · ${audit?.confidence} confidence`
    : replay?.mode === "sample"
      ? "Birdeye WAC · sampled trades"
      : replay?.mode === "truncated"
        ? "Birdeye WAC · truncated ledger"
        : replayLoading
          ? "Building wallet ledger"
          : "Birdeye WAC summary";
  const busy = rendering;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="video-modal"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        // Any click or key inside the editor is a gesture that can unblock audio.
        onPointerDownCapture={() => audioRef.current?.unlock()}
        onKeyDownCapture={() => audioRef.current?.unlock()}
        onPointerDownOutside={(event) => busy && event.preventDefault()}
      >
        <header className="video-modal-header">
          <div>
            <Badge variant="outline" className={`mode-pill ${replay?.mode ?? "loading"}`}>{modeLabel}</Badge>
            <DialogTitle asChild>
              <h2>${data.token.symbol ?? "TOKEN"} <small>{walletLabel(row.wallet)}</small></h2>
            </DialogTitle>
            <DialogDescription className="sr-only">Preview and export a PnL video of this wallet&apos;s trades.</DialogDescription>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={onClose} disabled={busy} aria-label="Close video editor"><X size={18} /></Button>
            </TooltipTrigger>
            <TooltipContent>Close (Esc)</TooltipContent>
          </Tooltip>
        </header>

        <div className="editor-body">
          <div className="editor-stage-col">
            <div className={`video-stage ${shape}`}>
              {/* Sized in JSX: the dialog mounts through a portal, after effects that read the ref. */}
              <canvas ref={attachCanvas} width={VIDEO_FORMATS[shape].width} height={VIDEO_FORMATS[shape].height} aria-label="Video preview" />
              {(replayLoading || timeframeLoading) && (
                <div className="video-stage-status">{replayLoading ? "Reading balance changes and swaps…" : `Loading ${timeframe} candles…`}</div>
              )}
              {!replayLoading && !timeframeLoading && sound.enabled && !audioRunning && (
                <button type="button" className="video-stage-status sound-blocked" onClick={() => audioRef.current?.unlock()}>
                  <SpeakerSlash size={14} aria-hidden="true" /> The browser paused sound. Click to turn it on
                </button>
              )}
            </div>
            <div className="video-timeline">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" className="rounded-full" onClick={togglePlay} disabled={busy || timeframeLoading || !scene} aria-label={playing ? "Pause preview" : "Play preview"}>
                    {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{playing ? "Pause" : "Play with sound"}</TooltipContent>
              </Tooltip>
              <span>{clock(playhead * clipSeconds)}</span>
              <Slider
                aria-label="Video playhead"
                min={0}
                max={1_000}
                step={1}
                value={[Math.round(playhead * 1_000)]}
                disabled={busy || timeframeLoading || !scene}
                onValueChange={([value]) => {
                  const next = (value ?? 0) / 1_000;
                  setPlaying(false);
                  playheadRef.current = next;
                  setPlayhead(next);
                }}
              />
              <span>{clock(clipSeconds)}</span>
              <SwitchField id="loop" label="Loop" checked={looping} onChange={setLooping} disabled={busy} />
            </div>
            <div className="replay-facts">
              <div className="video-legend" aria-label="Trade marker legend">
                <span><i className="buy" aria-hidden="true" />Buy</span>
                <span><i className="sell" aria-hidden="true" />Sell</span>
                <b>
                  {replayLoading
                    ? "Building wallet ledger…"
                    : `${bins.plotted.toLocaleString()} of ${fills.toLocaleString()} trades plotted${bins.outside > 0 ? ` · ${bins.outside.toLocaleString()} outside range` : ""}`}
                </b>
              </div>
              {replay?.mode === "audited" && audit && (
                <p className="video-note">
                  PnL replays the ledger at each candle: {audit.ledger.buys} buys, {audit.ledger.sells} sells, {audit.ledger.transfersIn + audit.ledger.transfersOut} transfers.
                  {" "}Δ vs Birdeye WAC {compactUsd(audit.deltaUsd)}{audit.reasons.length > 0 ? `. ${audit.reasons.join("; ")}.` : "."}
                </p>
              )}
              {replay?.note && <p className="video-note">{replay.note}</p>}
              {replay?.mode === "summary" && !replayLoading && (
                <p className="video-note">{replayError ? `Ledger unavailable (${replayError}). ` : ""}Birdeye WAC totals only: no trade markers, PnL counts up to the final summary.</p>
              )}
              {replayStats && <p className="video-note"><UsageLine usage={replayStats.usage} elapsedMs={replayStats.elapsedMs} /> for this replay</p>}
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
          </div>

          <aside className="editor-panel" aria-label="Video settings">
            <Tabs defaultValue="chart" className="panel-tabs">
              <TabsList className="w-full">
                <TabsTrigger value="chart"><ChartLineUp size={15} aria-hidden="true" />Chart</TabsTrigger>
                <TabsTrigger value="format"><FilmStrip size={15} aria-hidden="true" />Format</TabsTrigger>
                <TabsTrigger value="effects"><Sparkle size={15} aria-hidden="true" />Effects</TabsTrigger>
              </TabsList>

              <TabsContent value="chart" className="panel-group">
                <Label className="field-label">Chart range</Label>
                <Segmented
                  label="Chart range"
                  options={["wallet", "token"] as const}
                  value={effectiveRange}
                  onChange={chooseRange}
                  disabled={busy}
                  isDisabled={(option) => option === "wallet" && !activity}
                  render={(option) => (option === "wallet" ? "Wallet window" : "Full history")}
                />
                <p className="field-hint">
                  {series ? `${day(series.from)} → ${day(series.to)} UTC` : "Waiting for wallet history…"}
                  {effectiveRange === "wallet" && activity ? ` · ${activity.holding ? "first fill → now (still holding)" : "first fill → last fill"} · ${PAD_BARS} bars of context` : ""}
                </p>
                <Label className="field-label">Candles <small>{timeframeLoading ? `fetching ${timeframe}…` : series ? `${series.candles.length.toLocaleString()} × ${series.timeframe}` : ""}</small></Label>
                <Segmented
                  label="Candle timeframe"
                  options={REPLAY_TIMEFRAMES}
                  value={timeframe}
                  onChange={chooseTimeframe}
                  disabled={busy || replayLoading}
                  isDisabled={(option) => {
                    const range = windowFor(effectiveRange, option);
                    return expectedCandleCount(range.from, range.to, option) > MAX_REPLAY_CANDLES
                      || Boolean(data.demo && TIMEFRAME_SECONDS[option] < TIMEFRAME_SECONDS[baseTimeframe]);
                  }}
                />
                <p className="field-hint">Greyed timeframes would exceed {MAX_REPLAY_CANDLES.toLocaleString()} candles for this range.</p>
                {timeframeError && <p className="field-error" role="alert">{timeframeError}</p>}
              </TabsContent>

              <TabsContent value="format" className="panel-group">
                <Label className="field-label">Aspect ratio</Label>
                <Segmented
                  label="Aspect ratio"
                  options={shapeOptions}
                  value={shape}
                  onChange={changed(setShape)}
                  disabled={busy}
                  render={(option) => VIDEO_FORMATS[option].label}
                />
                <Label className="field-label">Length <small>{clock(clipSeconds)} · result card {timeline.outroSeconds.toFixed(1)}s</small></Label>
                <Segmented
                  label="Video length presets"
                  options={CLIP_DURATIONS.map(String)}
                  value={CLIP_DURATIONS.some((seconds) => seconds === clipSeconds) ? String(clipSeconds) : null}
                  onChange={(value) => applyDuration(Number(value))}
                  disabled={busy}
                  render={(value) => (Number(value) < 60 ? `${value}s` : `${Number(value) / 60}m`)}
                />
                <div className="duration-row">
                  <Slider
                    aria-label="Adjust video length"
                    min={MIN_VIDEO_SECONDS}
                    max={MAX_VIDEO_SECONDS}
                    step={1}
                    value={[clipSeconds]}
                    disabled={busy}
                    onValueChange={([value]) => applyDuration(value ?? clipSeconds)}
                  />
                  <label className="duration-custom">
                    <input
                      type="number"
                      min={MIN_VIDEO_SECONDS}
                      max={MAX_VIDEO_SECONDS}
                      step={1}
                      inputMode="numeric"
                      value={durationDraft}
                      disabled={busy}
                      aria-label="Custom video length in seconds"
                      onChange={(event) => {
                        const draft = event.target.value;
                        setDurationDraft(draft);
                        const seconds = Number(draft);
                        if (draft.trim() !== "" && Number.isInteger(seconds) && seconds >= MIN_VIDEO_SECONDS && seconds <= MAX_VIDEO_SECONDS) {
                          setClipSeconds(seconds);
                          setGenerated(null);
                        }
                      }}
                      onBlur={commitDurationDraft}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                    <span>sec</span>
                  </label>
                </div>
                <Label className="field-label">Trade values in</Label>
                <Segmented
                  label="Trade value unit"
                  options={["USDC", "SOL"] as const}
                  value={quoteUnit}
                  onChange={changed(setQuoteUnit)}
                  disabled={busy}
                  isDisabled={(unit) => unit === "SOL" && data.solPriceUsd <= 0}
                />
              </TabsContent>

              <TabsContent value="effects" className="panel-group">
                <div className="switch-grid">
                  <SwitchField id="fx-popups" label="Trade popups" checked={effectsOn} onChange={changed(setEffectsOn)} disabled={busy} />
                  <SwitchField id="fx-markers" label="Markers + avg cost" checked={markersOn} onChange={changed(setMarkersOn)} disabled={busy} />
                </div>
                <Label className="field-label">Popup hold <small>{holdSeconds.toFixed(1)}s</small></Label>
                <Slider
                  aria-label="Popup hold"
                  min={0.4}
                  max={2.5}
                  step={0.1}
                  value={[holdSeconds]}
                  disabled={busy || !effectsOn}
                  onValueChange={([value]) => {
                    setHoldSeconds(value ?? holdSeconds);
                    setGenerated(null);
                  }}
                />
                <p className="field-hint">Fills less than half a second apart share one popup, and its number climbs as they land.</p>
                <div className="field-label sound-heading">
                  <span>Sound</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        aria-label={sound.enabled ? "Mute all sound" : "Turn sound on"}
                        onClick={() => {
                          audioRef.current?.unlock();
                          setSound((value) => ({ ...value, enabled: !value.enabled }));
                          setGenerated(null);
                        }}
                        disabled={busy}
                      >
                        {sound.enabled ? <SpeakerHigh size={16} /> : <SpeakerSlash size={16} />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{sound.enabled ? "Mute" : "Unmute"}</TooltipContent>
                  </Tooltip>
                </div>
                <Segmented
                  label="Sound pack"
                  options={["meme", "clean"] as const}
                  value={sound.pack}
                  onChange={(pack) => {
                    setSound((current) => ({ ...current, pack }));
                    setGenerated(null);
                  }}
                  disabled={busy || !sound.enabled}
                  render={(pack) => (pack === "meme" ? "Meme" : "Clean")}
                />
                <div className="switch-grid">
                  <SwitchField id="sfx-trades" label="Trades" checked={sound.trades} onChange={(value) => { setSound((current) => ({ ...current, trades: value })); setGenerated(null); }} disabled={busy || !sound.enabled} />
                  <SwitchField id="sfx-milestones" label="Milestones" checked={sound.milestones} onChange={(value) => { setSound((current) => ({ ...current, milestones: value })); setGenerated(null); }} disabled={busy || !sound.enabled} />
                  <SwitchField id="sfx-result" label="Result sting" checked={sound.outro} onChange={(value) => { setSound((current) => ({ ...current, outro: value })); setGenerated(null); }} disabled={busy || !sound.enabled} />
                </div>
                <p className="field-hint">
                  {sound.pack === "meme"
                    ? "Ka-ching on sells and a “bandos” call each time PnL clears another $20K (wider steps for big winners), plus the counted result sting"
                    : "Blip on buys, till on sells, a fanfare each PnL milestone, and a counted result sting, all synthesised in the browser"}
                  . Mixed into the export
                  {encoder && encoder !== "probing" && !encoder.audio ? " (this browser cannot encode audio, so the file will be silent)" : ""}.
                </p>
              </TabsContent>
            </Tabs>

            <section className="panel-group export-group">
              <Button size="lg" className="w-full" onClick={() => void exportVideo()} disabled={busy || timeframeLoading || replayLoading || !scene || !encoder || encoder === "probing"}>
                <DownloadSimple size={17} weight="bold" />
                {rendering ? `Rendering ${Math.round(renderProgress * 100)}%` : encoder === "probing" ? "Checking encoder…" : encoder ? `Export ${encoder.ext.toUpperCase()} · ${VIDEO_FORMATS[shape].width}×${VIDEO_FORMATS[shape].height}` : "Video export unavailable"}
              </Button>
              {rendering && (
                <div className="video-progress">
                  <i style={{ width: `${Math.round(renderProgress * 100)}%` }} />
                  <span>Keep this tab open</span>
                  <Button variant="outline" size="sm" className="ml-auto h-6" onClick={() => exportAbortRef.current?.abort()}>Cancel</Button>
                </div>
              )}
              {generated && !rendering && (
                <div className="generated-video">
                  <video src={generated.url} controls playsInline />
                  <a href={generated.url} download={generated.name}><DownloadSimple size={15} weight="bold" />Save {encoder && encoder !== "probing" ? encoder.ext.toUpperCase() : "video"}</a>
                </div>
              )}
              <p className="field-hint">{clipSeconds}s at 30 fps · {sound.enabled ? "with sound" : "silent"} · rendered frame by frame in this browser</p>
            </section>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
