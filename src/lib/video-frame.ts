import type { BirdeyeCandle } from "@/server/birdeye/types";
import type { LedgerEvent } from "@/server/pnl/ledger";
import type { BoardRow } from "@/server/services/analyze-token";
import { TIMEFRAME_SECONDS, type ReplayTimeframe } from "./replay-timeframe";
import type { EventBins } from "./replay-window";
import {
  activeLabels,
  burstValueAt,
  compactAmount,
  compactUsd,
  easeOutCubic,
  easeOutExpo,
  formatPrice,
  OUTRO,
  signedUsd,
  smoothstep,
  type FillBurst,
  type VideoTimeline,
} from "./video-scene";
import { tradeValueInUnit, walletTradeTotals, walletVideoMetrics, type QuoteUnit } from "./wallet-video-metrics";

export type VideoShape = "landscape" | "portrait" | "square";

export const VIDEO_FORMATS: Record<VideoShape, { width: number; height: number; label: string }> = {
  landscape: { width: 1920, height: 1080, label: "16:9" },
  portrait: { width: 1080, height: 1920, label: "9:16" },
  square: { width: 1080, height: 1080, label: "1:1" },
};

/**
 * Birdeye Data terminal palette for a social clip: black ground, one teal
 * glow, white type, brand green as the only accent. Candles are muted so the
 * wallet's own fills are what the eye lands on. Red appears only as the
 * semantic loss/sell colour, always paired with a sign, label or shape.
 */
const C = {
  ground: "#000000",
  glow: "0, 55, 38",
  surface: "#171717",
  raised: "#262626",
  line: "#262626",
  lineStrong: "#404040",
  text: "#FFFFFF",
  text2: "#A3A3A3",
  text3: "#737373",
  brand: "#00FFA3",
  brandRgb: "0, 255, 163",
  loss: "#EF4444",
  lossRgb: "239, 68, 68",
  up: "rgba(0, 255, 163, 0.5)",
  down: "#4A4A4A",
};

const FONT = 'Geist, "Geist Fallback", ui-sans-serif, system-ui, sans-serif';
const font = (weight: number, size: number) => `${weight} ${Math.round(size)}px ${FONT}`;

interface Rect { x: number; y: number; w: number; h: number }

interface Layout {
  pad: number;
  header: Rect;
  chart: Rect;
  stats: Rect;
  footer: Rect;
  statColumns: number;
  stackedHeader: boolean;
  labelAt: "top" | "bottom";
  visibleBars: number;
  headAt: number;
  priceTop: number;
  priceBottom: number;
  size: {
    symbol: number; wallet: number; caption: number; pnl: number;
    statCaption: number; statValue: number; label: number; labelSub: number;
    axis: number; footer: number; logo: number;
    outroKicker: number; outroMeta: number; outroPnl: number; outroStat: number;
  };
}

function layoutFor(shape: VideoShape): Layout {
  if (shape === "portrait") {
    return {
      pad: 72,
      header: { x: 72, y: 84, w: 936, h: 330 },
      chart: { x: 72, y: 450, w: 936, h: 860 },
      stats: { x: 72, y: 1352, w: 936, h: 300 },
      footer: { x: 72, y: 1716, w: 936, h: 130 },
      statColumns: 2,
      stackedHeader: true,
      labelAt: "bottom",
      visibleBars: 46,
      headAt: 0.6,
      priceTop: 0.06,
      priceBottom: 0.24,
      size: {
        symbol: 54, wallet: 30, caption: 24, pnl: 140, statCaption: 22, statValue: 62, label: 74, labelSub: 28,
        axis: 22, footer: 24, logo: 44, outroKicker: 26, outroMeta: 34, outroPnl: 176, outroStat: 56,
      },
    };
  }
  if (shape === "square") {
    return {
      pad: 60,
      header: { x: 60, y: 48, w: 960, h: 176 },
      chart: { x: 60, y: 244, w: 960, h: 470 },
      stats: { x: 60, y: 736, w: 960, h: 150 },
      footer: { x: 60, y: 930, w: 960, h: 100 },
      statColumns: 4,
      stackedHeader: false,
      labelAt: "top",
      visibleBars: 64,
      headAt: 0.62,
      priceTop: 0.3,
      priceBottom: 0.06,
      size: {
        symbol: 44, wallet: 22, caption: 19, pnl: 96, statCaption: 16, statValue: 40, label: 56, labelSub: 22,
        axis: 18, footer: 19, logo: 34, outroKicker: 20, outroMeta: 26, outroPnl: 132, outroStat: 40,
      },
    };
  }
  return {
    pad: 72,
    header: { x: 72, y: 52, w: 1776, h: 190 },
    chart: { x: 72, y: 262, w: 1776, h: 548 },
    stats: { x: 72, y: 834, w: 1776, h: 128 },
    footer: { x: 72, y: 990, w: 1776, h: 70 },
    statColumns: 4,
    stackedHeader: false,
    labelAt: "top",
    visibleBars: 96,
    headAt: 0.66,
    priceTop: 0.3,
    priceBottom: 0.06,
    size: {
      symbol: 54, wallet: 26, caption: 22, pnl: 116, statCaption: 20, statValue: 54, label: 62, labelSub: 24,
      axis: 20, footer: 22, logo: 38, outroKicker: 24, outroMeta: 30, outroPnl: 164, outroStat: 52,
    },
  };
}

export interface VideoScene {
  shape: VideoShape;
  symbol: string;
  wallet: string;
  solPriceUsd: number;
  candles: BirdeyeCandle[];
  timeframe: ReplayTimeframe;
  row: BoardRow;
  events: LedgerEvent[];
  bins: EventBins;
  bursts: FillBurst[];
  timeline: VideoTimeline;
  holdSeconds: number;
  unit: QuoteUnit;
  effects: boolean;
  markers: boolean;
  /** e.g. "Ledger PnL · high confidence" or "Estimated PnL path". */
  basis: string;
  logo: CanvasImageSource | null;
  /** Total PnL sampled across the replay, for the result card's curve. */
  pnlPath?: Array<{ t: number; totalUsd: number }>;
}

function walletLabel(wallet: string): string {
  return `${wallet.slice(0, 6)}…${wallet.slice(-6)}`;
}

/**
 * Geist digits are proportional; drawing each digit on a fixed advance keeps
 * counting numbers from jittering, the canvas equivalent of tabular-nums.
 */
function numberWidth(ctx: CanvasRenderingContext2D, text: string): number {
  const digit = Math.max(...Array.from("0123456789", (char) => ctx.measureText(char).width));
  let width = 0;
  for (const char of text) width += /\d/.test(char) ? digit : ctx.measureText(char).width;
  return width;
}

function drawNumber(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = "left"): number {
  const digit = Math.max(...Array.from("0123456789", (char) => ctx.measureText(char).width));
  const width = numberWidth(ctx, text);
  let cursor = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  const saved = ctx.textAlign;
  ctx.textAlign = "left";
  for (const char of text) {
    const advance = /\d/.test(char) ? digit : ctx.measureText(char).width;
    ctx.fillText(char, cursor + (/\d/.test(char) ? (digit - ctx.measureText(char).width) / 2 : 0), y);
    cursor += advance;
  }
  ctx.textAlign = saved;
  return width;
}

function caption(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = C.text3, align: CanvasTextAlign = "left") {
  ctx.font = font(600, size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.letterSpacing = `${(size * 0.12).toFixed(1)}px`;
  ctx.fillText(text, x, y);
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function triangle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, up: boolean) {
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * 0.95, y + size * 0.65);
    ctx.lineTo(x - size * 0.95, y + size * 0.65);
  } else {
    ctx.moveTo(x, y + size);
    ctx.lineTo(x + size * 0.95, y - size * 0.65);
    ctx.lineTo(x - size * 0.95, y - size * 0.65);
  }
  ctx.closePath();
}

function pnlColor(value: number): string {
  return value < 0 ? C.loss : C.brand;
}

let grain: CanvasPattern | null | undefined;

/** A fixed, seeded grain tile: identical every frame, so it costs the encoder nothing. */
function grainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (grain !== undefined) return grain;
  if (typeof document === "undefined") return (grain = null);
  const tile = document.createElement("canvas");
  tile.width = 160;
  tile.height = 160;
  const tileCtx = tile.getContext("2d");
  if (!tileCtx) return (grain = null);
  const image = tileCtx.createImageData(160, 160);
  let seed = 1_234_567;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 16_807) % 2_147_483_647;
    const value = seed % 255;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 10;
  }
  tileCtx.putImageData(image, 0, 0);
  return (grain = ctx.createPattern(tile, "repeat"));
}

/** Black ground, a lime-to-teal corner glow and fine grain, after the campaign graphics. */
function ground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, w, h);
  const size = Math.max(w, h);
  const corner = ctx.createRadialGradient(w * 1.02, -h * 0.02, 0, w * 1.02, -h * 0.02, size * 0.62);
  corner.addColorStop(0, "rgba(128, 160, 92, 0.42)");
  corner.addColorStop(0.32, "rgba(24, 112, 86, 0.26)");
  corner.addColorStop(1, "rgba(0, 55, 38, 0)");
  ctx.fillStyle = corner;
  ctx.fillRect(0, 0, w, h);
  const floor = ctx.createRadialGradient(w * 0.1, h * 1.05, 0, w * 0.1, h * 1.05, size * 0.5);
  floor.addColorStop(0, `rgba(${C.glow}, 0.32)`);
  floor.addColorStop(1, `rgba(${C.glow}, 0)`);
  ctx.fillStyle = floor;
  ctx.fillRect(0, 0, w, h);
  const pattern = grainPattern(ctx);
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
  }
}

/** Frosted pill: translucent fill, hairline rim, a soft top highlight. */
function glassPill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accentRgb?: string) {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = "rgba(18, 22, 21, 0.78)";
  ctx.fill();
  const sheen = ctx.createLinearGradient(0, y, 0, y + h);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0.10)");
  sheen.addColorStop(0.5, "rgba(255, 255, 255, 0.02)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = sheen;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = accentRgb ? `rgba(${accentRgb}, 0.45)` : "rgba(255, 255, 255, 0.14)";
  ctx.stroke();
}

/** A field of dots on a curved horizon, the particle globe of the brand art. */
function dotHorizon(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number, t: number) {
  const rows = 16;
  const cx = w / 2;
  for (let row = 0; row < rows; row += 1) {
    const z = row / (rows - 1);
    const y0 = h * (0.8 + 0.22 * z ** 1.5);
    const spacing = w * (0.018 + 0.03 * z);
    const columns = Math.ceil(w / spacing / 2) + 2;
    for (let column = -columns; column <= columns; column += 1) {
      const drift = ((t * 6 * (0.4 + z)) % spacing);
      const x = cx + column * spacing + drift;
      const bend = ((x - cx) / (w * 0.75)) ** 2;
      const y = y0 + bend * h * 0.07 * (1 - z * 0.5);
      const seed = Math.sin(row * 91.7 + column * 12.9898) * 43_758.5453;
      const noise = seed - Math.floor(seed);
      const a = alpha * (0.08 + 0.32 * z) * (0.4 + 0.6 * noise);
      if (a < 0.01) continue;
      ctx.fillStyle = `rgba(160, 255, 214, ${a.toFixed(3)})`;
      ctx.fillRect(x, y, 1.2 + 1.8 * z, 1.2 + 1.8 * z);
    }
  }
}

export function drawMessage(ctx: CanvasRenderingContext2D, message: string): void {
  const { width: w, height: h } = ctx.canvas;
  ground(ctx, w, h);
  ctx.fillStyle = C.text2;
  ctx.font = font(500, Math.min(w, h) * 0.034);
  ctx.textAlign = "center";
  ctx.fillText(message, w / 2, h / 2);
  ctx.textAlign = "left";
}

/** Range over fully formed bars [end - span + 1, end], so the axis moves only when bars do. */
function rangeAt(candles: BirdeyeCandle[], end: number, span: number) {
  let low = Infinity;
  let high = -Infinity;
  for (let i = Math.max(0, end - span + 1); i <= Math.min(end, candles.length - 1); i += 1) {
    low = Math.min(low, candles[i]!.l);
    high = Math.max(high, candles[i]!.h);
  }
  return { low, high };
}

/**
 * One frame of the clip at clip time `t` (seconds). Pure: the preview and the
 * exporter call this with the same scene and get the same pixels.
 */
export function drawVideoFrame(ctx: CanvasRenderingContext2D, t: number, scene: VideoScene): void {
  const { width: w, height: h } = ctx.canvas;
  const L = layoutFor(scene.shape);
  const { candles, timeline } = scene;
  ground(ctx, w, h);
  if (candles.length < 2) {
    drawMessage(ctx, "No OHLCV candles in this range");
    return;
  }

  const reveal = Math.min(1, Math.max(0, t / timeline.replaySeconds));
  const exact = reveal * (candles.length - 1);
  const settled = Math.floor(exact);
  const forming = Math.min(candles.length - 1, settled + 1);
  const growth = settled >= candles.length - 1 ? 1 : smoothstep(exact - settled);
  const formingCandle = candles[forming]!;
  const settledCandle = candles[settled]!;
  const currentPrice = settled >= candles.length - 1
    ? settledCandle.c
    : formingCandle.o + (formingCandle.c - formingCandle.o) * growth;

  const currentEvents = reveal >= 1
    ? scene.events
    : scene.events.filter((_, index) => (scene.bins.bars[index] ?? -1) <= settled);
  const metrics = walletVideoMetrics({
    row: scene.row,
    events: scene.events,
    currentEvents,
    currentPrice,
    finalPrice: candles.at(-1)!.c,
    reveal,
  });
  const totalsArgs = { row: scene.row, events: scene.events, currentEvents, reveal, solPriceUsd: scene.solPriceUsd };
  const totalsUsd = walletTradeTotals({ ...totalsArgs, unit: "USDC" });
  const totals = scene.unit === "USDC" ? totalsUsd : walletTradeTotals({ ...totalsArgs, unit: scene.unit });
  const unitText = (value: number) => (scene.unit === "USDC" ? compactUsd(value) : compactAmount(value, "SOL"));
  const roi = totalsUsd.bought > 0 ? metrics.totalUsd / totalsUsd.bought : null;
  const roiText = roi === null ? "ROI N/A" : `ROI ${roi >= 0 ? "+" : "−"}${Math.abs(roi * 100).toLocaleString("en-US", { maximumFractionDigits: Math.abs(roi) >= 10 ? 0 : 1 })}%`;

  // ── Header ────────────────────────────────────────────────────────────
  const S = L.size;
  const H = L.header;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.text;
  ctx.font = font(700, S.symbol);
  ctx.fillText(`$${scene.symbol}`, H.x, H.y + S.symbol);
  ctx.fillStyle = C.text2;
  ctx.font = font(500, S.wallet);
  ctx.fillText(walletLabel(scene.wallet), H.x, H.y + S.symbol + S.wallet * 1.55);
  const pnlText = signedUsd(metrics.totalUsd);
  if (L.stackedHeader) {
    const captionY = H.y + H.h - S.pnl * 0.98;
    caption(ctx, "TOTAL PNL", H.x, captionY, S.caption);
    caption(ctx, roiText, H.x + H.w, captionY, S.caption, C.text2, "right");
    ctx.font = font(800, S.pnl);
    ctx.fillStyle = pnlColor(metrics.totalUsd);
    drawNumber(ctx, pnlText, H.x - S.pnl * 0.04, H.y + H.h);
  } else {
    const right = H.x + H.w;
    caption(ctx, `TOTAL PNL  ·  ${roiText}`, right, H.y + S.caption * 1.4, S.caption, C.text3, "right");
    ctx.font = font(800, S.pnl);
    ctx.fillStyle = pnlColor(metrics.totalUsd);
    drawNumber(ctx, pnlText, right, H.y + H.h - S.pnl * 0.1, "right");
  }

  // ── Chart ─────────────────────────────────────────────────────────────
  const R = L.chart;
  const slot = R.w / L.visibleBars;
  const headX = R.x + R.w * L.headAt;
  const xAt = (index: number) => headX - (exact - index) * slot;
  const span = Math.ceil(L.visibleBars * L.headAt) + 1;
  const a = rangeAt(candles, settled, span);
  const b = rangeAt(candles, forming, span);
  const mix = exact - settled;
  let low = a.low + (b.low - a.low) * mix;
  let high = a.high + (b.high - a.high) * mix;
  const padRange = Math.max(high - low, high * 0.02, 1e-18) * 0.06;
  low -= padRange;
  high += padRange;
  const plotTop = R.y + R.h * L.priceTop;
  const plotBottom = R.y + R.h * (1 - L.priceBottom);
  const yAt = (price: number) => plotBottom - ((price - low) / Math.max(high - low, 1e-18)) * (plotBottom - plotTop);

  ctx.save();
  ctx.beginPath();
  ctx.rect(R.x, R.y, R.w, R.h);
  ctx.clip();

  // Three quiet guides with prices on the right edge.
  const priceY = yAt(currentPrice);
  ctx.lineWidth = 1;
  for (let line = 0; line < 3; line += 1) {
    const price = low + ((high - low) * (line + 0.5)) / 3;
    const y = yAt(price);
    ctx.strokeStyle = C.surface;
    ctx.beginPath();
    ctx.moveTo(R.x, y);
    ctx.lineTo(R.x + R.w, y);
    ctx.stroke();
    // The live price tag owns the right edge near its own level.
    if (Math.abs(y - S.axis * 0.8 - priceY) < S.axis * 2.2) continue;
    ctx.fillStyle = C.text3;
    ctx.font = font(500, S.axis);
    ctx.textAlign = "right";
    ctx.fillText(formatPrice(price), R.x + R.w, y - S.axis * 0.45);
    ctx.textAlign = "left";
  }

  const first = Math.max(0, Math.floor(exact - L.visibleBars * L.headAt) - 1);
  const bodyWidth = Math.max(2, slot * 0.62);
  for (let i = first; i <= forming; i += 1) {
    const candle = candles[i]!;
    const isForming = i === forming && forming > settled;
    const k = isForming ? growth : 1;
    if (k <= 0) continue;
    const close = isForming ? candle.o + (candle.c - candle.o) * k : candle.c;
    const top = isForming ? Math.max(candle.o, close, candle.o + (candle.h - candle.o) * k) : candle.h;
    const bottom = isForming ? Math.min(candle.o, close, candle.o + (candle.l - candle.o) * k) : candle.l;
    const x = xAt(i);
    const color = close >= candle.o ? C.up : C.down;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.5, slot * 0.09);
    ctx.beginPath();
    ctx.moveTo(x, yAt(top));
    ctx.lineTo(x, yAt(bottom));
    ctx.stroke();
    const y1 = yAt(Math.max(candle.o, close));
    const y2 = yAt(Math.min(candle.o, close));
    ctx.fillRect(x - bodyWidth / 2, y1, bodyWidth, Math.max(2, y2 - y1));
  }

  // Average cost of what the wallet still holds (ledger clips only).
  if (scene.markers && metrics.avgCostUsd && metrics.avgCostUsd > low && metrics.avgCostUsd < high && reveal < 1) {
    const y = yAt(metrics.avgCostUsd);
    ctx.setLineDash([3, 7]);
    ctx.strokeStyle = C.text3;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(R.x, y);
    ctx.lineTo(headX, y);
    ctx.stroke();
    ctx.setLineDash([]);
    caption(ctx, `AVG COST ${formatPrice(metrics.avgCostUsd)}`, R.x, y - S.axis * 0.5, S.axis * 0.85, C.text3);
  }

  // Live price: dashed to the edge, tagged.
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = C.lineStrong;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(headX, priceY);
  ctx.lineTo(R.x + R.w, priceY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = font(600, S.axis);
  const tag = formatPrice(currentPrice);
  const tagW = ctx.measureText(tag).width + S.axis * 1.1;
  const tagH = S.axis * 1.7;
  roundRect(ctx, R.x + R.w - tagW, priceY - tagH / 2, tagW, tagH, 4);
  ctx.fillStyle = C.raised;
  ctx.fill();
  ctx.fillStyle = C.text;
  ctx.textAlign = "right";
  ctx.fillText(tag, R.x + R.w - S.axis * 0.55, priceY + S.axis * 0.36);
  ctx.textAlign = "left";

  const labels = scene.effects && t < timeline.replaySeconds + 0.4 ? activeLabels(scene.bursts, t, scene.holdSeconds) : [];
  const liveBars = new Set(labels.filter((label) => label.exit === 0).flatMap((label) => label.burst.bars.map((bar) => bar.bar)));

  if (scene.markers) {
    for (const [bar, fills] of scene.bins.fills) {
      if (bar < first || bar > settled) continue;
      const candle = candles[bar]!;
      const x = xAt(bar);
      const live = liveBars.has(bar);
      const size = Math.max(9, Math.min(17, slot * 0.42)) * (live ? 1.35 : 1);
      const draw = (side: "buy" | "sell") => {
        const up = side === "buy";
        const y = up ? yAt(candle.l) + size * 1.7 : yAt(candle.h) - size * 1.7;
        const rgb = up ? C.brandRgb : C.lossRgb;
        if (live) {
          ctx.fillStyle = `rgba(${rgb}, 0.18)`;
          ctx.beginPath();
          ctx.arc(x, y, size * 2.1, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = up ? C.brand : C.loss;
        triangle(ctx, x, y, size, up);
        ctx.fill();
      };
      if (fills.buy.length > 0) draw("buy");
      if (fills.sell.length > 0) draw("sell");
    }
  }
  ctx.restore();

  // ── Fill popups: bare type over a colour wash ─────────────────────────
  for (const label of labels) {
    const values = burstValueAt(label.burst, t, (event) => tradeValueInUnit(event, scene.unit, scene.solPriceUsd));
    const lines = [
      values.buy > 0 ? { text: `BUY  ${unitText(values.buy)}`, color: C.brand, rgb: C.brandRgb, count: values.buys } : null,
      values.sell > 0 ? { text: `SELL  ${unitText(values.sell)}`, color: C.loss, rgb: C.lossRgb, count: values.sells } : null,
    ].filter((line): line is NonNullable<typeof line> => Boolean(line));
    if (lines.length === 0) continue;
    const entrance = easeOutExpo(label.enter);
    // A displaced label clears out fast and high so it never reads as a
    // second number under the new one.
    const alpha = Math.min(1, label.enter * 5) * (1 - label.exit) ** 2;
    const rise = (1 - entrance) * 18 - easeOutCubic(label.exit) * 56;
    const scale = 0.94 + 0.06 * entrance;
    const lineGap = S.label * 1.12;
    const blockH = lineGap * lines.length + S.labelSub * 1.4;
    const centerX = R.x + R.w / 2;
    const top = L.labelAt === "top" ? R.y + S.label * 0.4 : R.y + R.h - blockH - S.label * 0.15;
    const washAge = t - label.burst.start;
    const wash = label.exit > 0 ? 0 : washAge < 0.2 ? washAge / 0.2 : Math.max(0, 1 - (washAge - 0.2) / 0.7);

    if (wash > 0) {
      const split = lines.length > 1;
      lines.forEach((line, index) => {
        const anchorX = split ? (index === 0 ? R.x + R.w : R.x) : centerX;
        const anchorY = top + blockH / 2;
        const radius = Math.max(R.w * (split ? 0.7 : 0.5), 340);
        const gradient = ctx.createRadialGradient(anchorX, anchorY, 0, anchorX, anchorY, radius);
        gradient.addColorStop(0, `rgba(${line.rgb}, ${(0.3 * wash).toFixed(3)})`);
        gradient.addColorStop(0.45, `rgba(${line.rgb}, ${(0.1 * wash).toFixed(3)})`);
        gradient.addColorStop(1, `rgba(${line.rgb}, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(R.x, R.y, R.w, R.h);
      });
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(centerX, top + rise);
    ctx.scale(scale, scale);
    ctx.font = font(700, S.label * 0.78);
    const glyph = S.label * 0.34;
    const padX = S.label * 0.42;
    const pillH = S.label * 1.02;
    const widest = Math.max(...lines.map((line) => numberWidth(ctx, line.text))) + glyph * 2.4 + padX * 2;
    const fit = Math.min(1, (R.w * 0.92) / widest);
    ctx.scale(fit, fit);
    lines.forEach((line, index) => {
      ctx.font = font(700, S.label * 0.78);
      const textW = numberWidth(ctx, line.text);
      const pillW = textW + glyph * 2.4 + padX * 2;
      const y = lineGap * index;
      glassPill(ctx, -pillW / 2, y, pillW, pillH, line.rgb);
      ctx.fillStyle = line.color;
      triangle(ctx, -pillW / 2 + padX + glyph, y + pillH / 2, glyph, line.color === C.brand);
      ctx.fill();
      drawNumber(ctx, line.text, -pillW / 2 + padX + glyph * 2.4, y + pillH * 0.68);
    });
    const fills = values.buys + values.sells;
    const sub = fills > 1
      ? [values.buys ? `${values.buys} buy${values.buys > 1 ? "s" : ""}` : "", values.sells ? `${values.sells} sell${values.sells > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ")
      : `at ${formatPrice(currentPrice)}`;
    ctx.font = font(500, S.labelSub);
    ctx.fillStyle = C.text2;
    ctx.textAlign = "center";
    ctx.fillText(sub, 0, lineGap * (lines.length - 1) + pillH + S.labelSub * 1.35);
    ctx.textAlign = "left";
    ctx.restore();
  }

  // ── Stats band: shared hairlines, captions keyed to the markers ──────
  const B = L.stats;
  const cells = [
    { label: "TOTAL BUY", glyph: "buy" as const, text: unitText(totals.bought), color: C.text },
    { label: "TOTAL SELL", glyph: "sell" as const, text: unitText(totals.sold), color: C.text },
    { label: "REALIZED", text: signedUsd(metrics.realizedUsd), color: pnlColor(metrics.realizedUsd) },
    { label: "UNREALIZED", text: signedUsd(metrics.unrealizedUsd), color: pnlColor(metrics.unrealizedUsd) },
  ];
  const rows = Math.ceil(cells.length / L.statColumns);
  const cellW = B.w / L.statColumns;
  const cellH = B.h / rows;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(B.x, B.y);
  ctx.lineTo(B.x + B.w, B.y);
  for (let row = 1; row < rows; row += 1) {
    ctx.moveTo(B.x, B.y + row * cellH);
    ctx.lineTo(B.x + B.w, B.y + row * cellH);
  }
  for (let column = 1; column < L.statColumns; column += 1) {
    ctx.moveTo(B.x + column * cellW, B.y + S.statCaption);
    ctx.lineTo(B.x + column * cellW, B.y + B.h - S.statCaption * 0.5);
  }
  ctx.stroke();
  cells.forEach((cell, index) => {
    const column = index % L.statColumns;
    const row = Math.floor(index / L.statColumns);
    const x = B.x + column * cellW + (column === 0 ? 0 : S.statCaption * 1.2);
    const y = B.y + row * cellH;
    let captionX = x;
    if (cell.glyph) {
      ctx.fillStyle = cell.glyph === "buy" ? C.brand : C.loss;
      triangle(ctx, x + S.statCaption * 0.45, y + cellH * 0.34 - S.statCaption * 0.35, S.statCaption * 0.42, cell.glyph === "buy");
      ctx.fill();
      captionX += S.statCaption * 1.3;
    }
    caption(ctx, cell.label, captionX, y + cellH * 0.34, S.statCaption);
    ctx.font = font(700, S.statValue);
    ctx.fillStyle = cell.color;
    const fit = Math.min(1, (cellW - S.statCaption * 2) / Math.max(numberWidth(ctx, cell.text), 1));
    ctx.font = font(700, S.statValue * fit);
    drawNumber(ctx, cell.text, x, y + cellH * 0.34 + S.statValue * 1.08);
  });

  // ── Footer: progress, moment, basis, logo ────────────────────────────
  const F = L.footer;
  ctx.fillStyle = C.raised;
  ctx.fillRect(F.x, F.y, F.w, 4);
  ctx.fillStyle = C.brand;
  ctx.fillRect(F.x, F.y, F.w * reveal, 4);
  const timeOptions: Intl.DateTimeFormatOptions = TIMEFRAME_SECONDS[scene.timeframe] < 86_400
    ? { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }
    : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  const moment = new Date((reveal >= 1 ? candles.at(-1)! : settledCandle).unixTime * 1_000).toLocaleString("en-US", timeOptions);
  ctx.font = font(500, S.footer);
  ctx.fillStyle = C.text2;
  ctx.fillText(`${moment} UTC`, F.x, F.y + S.footer * 2.2);
  ctx.fillStyle = C.text3;
  ctx.fillText(scene.basis, F.x, F.y + S.footer * 3.7);
  drawLogo(ctx, scene.logo, F.x + F.w, F.y + S.footer * 1.2, S.logo, "right");

  if (t >= timeline.replaySeconds) drawOutro(ctx, t, scene, L, { totals, totalsUsd, unitText });
}

function drawLogo(ctx: CanvasRenderingContext2D, logo: CanvasImageSource | null, x: number, y: number, height: number, align: "right" | "center") {
  if (logo && "width" in logo && Number(logo.width) > 0) {
    const ratio = Number(logo.width) / Number(logo.height || 1);
    const width = height * ratio;
    const left = align === "right" ? x - width : x - width / 2;
    ctx.drawImage(logo, left, y, width, height);
    return;
  }
  // Text fallback per the brand's logo ladder: horizontal → logomark → text.
  ctx.font = font(600, height * 0.62);
  ctx.fillStyle = C.text;
  ctx.textAlign = align;
  ctx.fillText("birdeye data", x, y + height * 0.72);
  ctx.textAlign = "left";
}

/** Result card: veil, count-up, a punch on landing, then a still hold for the thumbnail. */
function drawOutro(
  ctx: CanvasRenderingContext2D,
  t: number,
  scene: VideoScene,
  L: Layout,
  values: { totals: { bought: number; sold: number }; totalsUsd: { bought: number; sold: number }; unitText: (value: number) => string },
) {
  const { width: w, height: h } = ctx.canvas;
  const S = L.size;
  const o = (t - scene.timeline.replaySeconds) / scene.timeline.outroSeconds;
  const veil = easeOutCubic(o / OUTRO.veil);
  ctx.fillStyle = `rgba(0, 0, 0, ${(0.985 * veil).toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);

  const total = scene.row.totalUsd;
  const win = total >= 0;
  const appear = easeOutCubic((o - OUTRO.appearStart) / OUTRO.appearSpan);
  const count = easeOutCubic((o - OUTRO.countStart) / (OUTRO.countEnd - OUTRO.countStart));
  const slam = (o - OUTRO.countEnd) / OUTRO.slamSpan;
  const landed = slam >= 0;
  const punch = landed ? 1 + 0.12 * (1 - easeOutCubic(slam)) : 1;
  const shake = !win && landed && slam < 1 ? Math.sin(slam * Math.PI * 6) * (1 - slam) * 12 : 0;

  const glow = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.55);
  glow.addColorStop(0, `rgba(${win ? C.glow : "40, 40, 40"}, ${(0.75 * appear).toFixed(3)})`);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  dotHorizon(ctx, w, h, appear, t);

  ctx.save();
  ctx.globalAlpha = appear;
  ctx.translate(0, (1 - appear) * 30);
  const cx = w / 2;
  const portrait = scene.shape === "portrait";
  const top = portrait ? h * 0.16 : scene.shape === "square" ? h * 0.13 : h * 0.12;
  caption(ctx, "RESULT", cx, top, S.outroKicker, C.brand, "center");
  // Token, wallet and basis as a row of glass chips.
  ctx.font = font(500, S.outroMeta * 0.78);
  const chips = [`$${scene.symbol}`, walletLabel(scene.wallet), scene.basis];
  const chipH = S.outroMeta * 1.45;
  const chipPad = S.outroMeta * 0.7;
  const chipGap = S.outroMeta * 0.4;
  const widths = chips.map((chip) => ctx.measureText(chip).width + chipPad * 2);
  const rowW = widths.reduce((sum, width) => sum + width, 0) + chipGap * (chips.length - 1);
  const chipScale = Math.min(1, (w - L.pad * 2) / rowW);
  ctx.save();
  ctx.translate(cx, top + S.outroMeta * 0.75);
  ctx.scale(chipScale, chipScale);
  let chipX = -rowW / 2;
  chips.forEach((chip, index) => {
    glassPill(ctx, chipX, 0, widths[index]!, chipH, index === 0 ? C.brandRgb : undefined);
    ctx.fillStyle = index === 0 ? C.brand : C.text2;
    ctx.textAlign = "center";
    ctx.fillText(chip, chipX + widths[index]! / 2, chipH * 0.66);
    chipX += widths[index]! + chipGap;
  });
  ctx.textAlign = "left";
  ctx.restore();

  const pnlY = top + S.outroMeta * 1.9 + S.outroPnl * 1.45;
  caption(ctx, "TOTAL PNL", cx, pnlY - S.outroPnl * 0.95, S.outroKicker, C.text3, "center");

  if (landed && win && slam < 1.6) {
    // Expanding ring and a deterministic spark burst on a winning landing.
    const k = easeOutCubic(Math.min(1, slam / 1.6));
    ctx.strokeStyle = `rgba(${C.brandRgb}, ${(0.55 * (1 - k)).toFixed(3)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, pnlY - S.outroPnl * 0.34, S.outroPnl * (0.7 + 1.9 * k), 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 18; i += 1) {
      const jitter = Math.sin(i * 12.9898) * 0.5 + 0.5;
      const angle = (i / 18) * Math.PI * 2 + jitter * 0.4;
      const distance = S.outroPnl * (1 + jitter * 1.4) * k;
      const size = 4 + jitter * 6;
      ctx.fillStyle = i % 3 === 0 ? `rgba(255, 255, 255, ${(1 - k).toFixed(3)})` : `rgba(${C.brandRgb}, ${(1 - k).toFixed(3)})`;
      ctx.fillRect(cx + Math.cos(angle) * distance * 1.6 - size / 2, pnlY - S.outroPnl * 0.34 + Math.sin(angle) * distance - size / 2, size, size);
    }
  }

  ctx.save();
  ctx.translate(cx + shake, pnlY - S.outroPnl * 0.34);
  ctx.scale(punch, punch);
  ctx.font = font(800, S.outroPnl);
  const pnlText = signedUsd(total * count);
  const fit = Math.min(1, (w - L.pad * 2) / numberWidth(ctx, signedUsd(total)));
  ctx.font = font(800, S.outroPnl * fit);
  ctx.fillStyle = pnlColor(total);
  drawNumber(ctx, pnlText, 0, S.outroPnl * fit * 0.34, "center");
  ctx.restore();

  const roi = values.totalsUsd.bought > 0 ? total / values.totalsUsd.bought : null;
  const roiText = roi === null ? "ROI N/A" : `ROI ${roi >= 0 ? "+" : "−"}${Math.abs(roi * 100 * count).toLocaleString("en-US", { maximumFractionDigits: Math.abs(roi) >= 10 ? 0 : 1 })}%`;
  ctx.font = font(700, S.outroKicker * 1.15);
  const pillW = ctx.measureText(roiText).width + S.outroKicker * 2;
  const pillH = S.outroKicker * 2.1;
  const pillY = pnlY + S.outroPnl * 0.35;
  roundRect(ctx, cx - pillW / 2, pillY, pillW, pillH, pillH / 2);
  ctx.strokeStyle = roi !== null && roi < 0 ? C.loss : C.brand;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = roi !== null && roi < 0 ? C.loss : C.brand;
  ctx.textAlign = "center";
  ctx.fillText(roiText, cx, pillY + pillH * 0.66);
  ctx.textAlign = "left";

  const buys = scene.events.filter((event) => event.kind === "buy").length;
  const sells = scene.events.filter((event) => event.kind === "sell").length;
  const stats = [
    { label: "TOTAL BUY", text: values.unitText(values.totals.bought * count) },
    { label: "TOTAL SELL", text: values.unitText(values.totals.sold * count) },
    { label: "REALIZED", text: signedUsd(scene.row.realizedUsd * count) },
    { label: "TRADES", text: buys + sells > 0 ? `${buys} B · ${sells} S` : `${scene.row.buys} B · ${scene.row.sells} S` },
  ];
  const columns = portrait ? 2 : 4;
  const gridW = portrait ? w - L.pad * 2 : Math.min(w - L.pad * 2, S.outroStat * 26);
  const cellW = gridW / columns;
  const gridY = pillY + pillH + S.outroStat * (portrait ? 1.6 : 1.3);
  stats.forEach((stat, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = cx - gridW / 2 + cellW * (column + 0.5);
    const y = gridY + row * S.outroStat * 2.6;
    caption(ctx, stat.label, x, y, S.outroKicker * 0.85, C.text3, "center");
    ctx.font = font(700, S.outroStat);
    const fit = Math.min(1, (cellW * 0.92) / Math.max(numberWidth(ctx, stat.text), 1));
    ctx.font = font(700, S.outroStat * fit);
    ctx.fillStyle = C.text;
    if (stat.label === "TRADES") {
      ctx.textAlign = "center";
      ctx.fillText(stat.text, x, y + S.outroStat * 1.2);
      ctx.textAlign = "left";
    } else {
      drawNumber(ctx, stat.text, x, y + S.outroStat * 1.2, "center");
    }
  });

  // PnL across the replay, drawn on as the total counts up, wherever the
  // format leaves room under the figures.
  const path = scene.pnlPath ?? [];
  if (path.length > 2) {
    const curveTop = gridY + Math.ceil(stats.length / columns) * S.outroStat * 2.6 + S.outroStat * 0.4;
    const curveBottom = h - L.pad - S.logo * 3.2;
    const curveH = Math.min(h * 0.17, curveBottom - curveTop);
    if (curveH > 80) {
      const width = portrait ? w - L.pad * 2 : gridW;
      const left = cx - width / 2;
      const values = [0, ...path.map((point) => point.totalUsd), total];
      const min = Math.min(...values);
      const max = Math.max(...values);
      const spread = Math.max(max - min, 1e-9);
      const tMax = scene.timeline.replaySeconds;
      const points = [...path, { t: tMax, totalUsd: total }]
        .filter((point) => point.t <= tMax * count + 1e-9)
        .map((point) => ({
          x: left + (point.t / tMax) * width,
          y: curveTop + S.outroKicker * 1.6 + (1 - (point.totalUsd - min) / spread) * (curveH - S.outroKicker * 1.6),
        }));
      caption(ctx, "PNL ACROSS THE REPLAY", left, curveTop, S.outroKicker * 0.85, C.text3);
      const zeroY = curveTop + S.outroKicker * 1.6 + (1 - (0 - min) / spread) * (curveH - S.outroKicker * 1.6);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(left, zeroY);
      ctx.lineTo(left + width, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
      if (points.length > 1) {
        const area = ctx.createLinearGradient(0, curveTop, 0, curveTop + curveH);
        area.addColorStop(0, `rgba(${win ? C.brandRgb : C.lossRgb}, 0.22)`);
        area.addColorStop(1, `rgba(${win ? C.brandRgb : C.lossRgb}, 0)`);
        ctx.beginPath();
        ctx.moveTo(points[0]!.x, zeroY);
        for (const point of points) ctx.lineTo(point.x, point.y);
        ctx.lineTo(points.at(-1)!.x, zeroY);
        ctx.closePath();
        ctx.fillStyle = area;
        ctx.fill();
        ctx.beginPath();
        points.forEach((point, index) => (index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
        ctx.strokeStyle = pnlColor(total);
        ctx.lineWidth = 4;
        ctx.lineJoin = "round";
        ctx.stroke();
        const tip = points.at(-1)!;
        ctx.fillStyle = pnlColor(total);
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const footY = h - L.pad - S.logo * 1.6;
  drawLogo(ctx, scene.logo, cx, footY, S.logo, "center");
  ctx.font = font(500, S.footer * 0.9);
  ctx.fillStyle = C.text3;
  ctx.textAlign = "center";
  ctx.fillText("PnL Replayer · Powered by Birdeye Data API", cx, footY + S.logo + S.footer * 1.4);
  ctx.textAlign = "left";
  ctx.restore();
}
