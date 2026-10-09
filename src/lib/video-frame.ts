import type { BirdeyeCandle } from "@/server/birdeye/types";
import type { LedgerEvent } from "@/server/pnl/ledger";
import type { BoardRow } from "@/server/services/analyze-token";
import type { ReplayTimeframe } from "./replay-timeframe";
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
import { identicon } from "./identicon";
import { entryMarketCap, formatMultiple, type WalletTag } from "./wallet-tags";
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
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
const font = (weight: number, size: number) => `${weight} ${Math.round(size)}px ${FONT}`;

interface Rect { x: number; y: number; w: number; h: number }

interface Layout {
  pad: number;
  header: Rect;
  chart: Rect;
  /** Bottom band: Invested, Entry MC and Sold, with the brand logo. */
  stats: Rect;
  /** Wide formats put the logo at the band's right end; portrait sets it under the band. */
  logoInBand: boolean;
  /** Portrait stacks identity, PnL and stats; wide formats split them left and right. */
  stackedHeader: boolean;
  labelAt: "top" | "bottom";
  visibleBars: number;
  headAt: number;
  priceTop: number;
  priceBottom: number;
  card: { maxW: number; pad: number; columns: number; curve: number; radius: number };
  size: {
    token: number; symbol: number; wallet: number; role: number; caption: number; pnl: number; pill: number;
    statCaption: number; statValue: number; label: number; labelSub: number;
    axis: number; footer: number; logo: number;
    outroKicker: number; outroMeta: number; outroPnl: number; outroStat: number;
  };
}

function layoutFor(shape: VideoShape): Layout {
  if (shape === "portrait") {
    return {
      pad: 72,
      header: { x: 72, y: 72, w: 936, h: 310 },
      chart: { x: 72, y: 420, w: 936, h: 1160 },
      stats: { x: 72, y: 1616, w: 936, h: 130 },
      logoInBand: false,
      stackedHeader: true,
      labelAt: "bottom",
      visibleBars: 46,
      headAt: 0.6,
      priceTop: 0.06,
      priceBottom: 0.24,
      card: { maxW: 936, pad: 56, columns: 2, curve: 300, radius: 40 },
      size: {
        token: 84, symbol: 56, wallet: 28, role: 17, caption: 22, pnl: 132, pill: 58, statCaption: 21, statValue: 50,
        label: 74, labelSub: 28, axis: 22, footer: 24, logo: 44,
        outroKicker: 26, outroMeta: 38, outroPnl: 188, outroStat: 58,
      },
    };
  }
  if (shape === "square") {
    return {
      pad: 60,
      header: { x: 60, y: 48, w: 960, h: 140 },
      chart: { x: 60, y: 196, w: 960, h: 690 },
      stats: { x: 60, y: 912, w: 960, h: 120 },
      logoInBand: true,
      stackedHeader: false,
      labelAt: "top",
      visibleBars: 64,
      headAt: 0.62,
      priceTop: 0.3,
      priceBottom: 0.06,
      card: { maxW: 960, pad: 40, columns: 4, curve: 170, radius: 28 },
      size: {
        token: 60, symbol: 42, wallet: 21, role: 13, caption: 17, pnl: 88, pill: 40, statCaption: 16, statValue: 34,
        label: 56, labelSub: 22, axis: 18, footer: 19, logo: 34,
        outroKicker: 20, outroMeta: 26, outroPnl: 124, outroStat: 38,
      },
    };
  }
  return {
    pad: 72,
    header: { x: 72, y: 52, w: 1776, h: 170 },
    chart: { x: 72, y: 246, w: 1776, h: 690 },
    stats: { x: 72, y: 962, w: 1776, h: 100 },
    logoInBand: true,
    stackedHeader: false,
    labelAt: "top",
    visibleBars: 96,
    headAt: 0.66,
    priceTop: 0.3,
    priceBottom: 0.06,
    card: { maxW: 1400, pad: 52, columns: 4, curve: 150, radius: 32 },
    size: {
      token: 72, symbol: 52, wallet: 24, role: 15, caption: 20, pnl: 112, pill: 50, statCaption: 19, statValue: 42,
      label: 62, labelSub: 24, axis: 20, footer: 22, logo: 38,
      outroKicker: 24, outroMeta: 30, outroPnl: 164, outroStat: 44,
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
  /** Token image; a monogram is drawn when it is missing. */
  tokenLogo?: CanvasImageSource | null;
  /** The wallet's Birdeye label, or "trader". */
  walletRole?: string;
  /** Achievement tags for the result card, at most two. */
  tags?: WalletTag[];
  /** Turns the average entry price into an entry market cap. */
  circulatingSupply?: number;
  /**
   * Chart labels in price or market cap. Market cap is price × circulating
   * supply, so the candles keep their shape and only the labels change.
   */
  axis?: ChartAxis;
}

export type ChartAxis = "price" | "mcap";

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

/** The hero figure in whole dollars ("+$198,971"); compact only past $10M. */
function heroUsd(value: number): string {
  if (Math.abs(value) >= 10_000_000) return signedUsd(value);
  const body = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0,
  }).format(Math.abs(value || 0));
  return `${value < 0 ? "−" : "+"}${body}`;
}

/** The wallet's identicon (shared with the app) clipped to a circle. */
function drawIdenticon(ctx: CanvasRenderingContext2D, wallet: string, x: number, y: number, size: number) {
  const face = identicon(wallet);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = face.background;
  ctx.fillRect(x, y, size, size);
  const cell = size / 6;
  ctx.fillStyle = face.foreground;
  face.cells.forEach((row, rowIndex) => row.forEach((on, column) => {
    if (on) ctx.fillRect(x + cell * (0.5 + column), y + cell * (0.5 + rowIndex), cell + 0.5, cell + 0.5);
  }));
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** The token's own logo in a circle, or a monogram when it could not load. */
function drawTokenAvatar(ctx: CanvasRenderingContext2D, image: CanvasImageSource | null | undefined, symbol: string, x: number, y: number, size: number) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = C.raised;
  ctx.fill();
  const width = image && "width" in image ? Number(image.width) : 0;
  const height = image && "height" in image ? Number(image.height) : 0;
  if (image && width > 0 && height > 0) {
    ctx.clip();
    // Cover-crop to the circle.
    const side = Math.min(width, height);
    ctx.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, x, y, size, size);
  } else {
    ctx.fillStyle = C.brand;
    ctx.font = font(800, size * 0.44);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((symbol.replace(/[^a-z0-9]/gi, "")[0] ?? "?").toUpperCase(), cx, cy + size * 0.02);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 1, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** Filled circle with a B or S, so side never rests on colour alone. */
function sideBadge(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, side: "buy" | "sell") {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = side === "buy" ? C.brand : C.loss;
  ctx.fill();
  ctx.save();
  ctx.fillStyle = "#050505";
  ctx.font = font(800, radius * 1.18);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(side === "buy" ? "B" : "S", x, y + radius * 0.06);
  ctx.restore();
}

/** Outlined label after the address, e.g. TRADER or SMART TRADER. */
function roleBadge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, height: number, align: "left" | "right"): number {
  const size = height * 0.56;
  ctx.font = font(600, size);
  ctx.letterSpacing = `${(size * 0.1).toFixed(1)}px`;
  const label = text.toUpperCase();
  const width = ctx.measureText(label).width + height * 0.8;
  const left = align === "right" ? x - width : x;
  roundRect(ctx, left, y, width, height, height / 2);
  ctx.strokeStyle = C.lineStrong;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = C.text2;
  ctx.textAlign = "center";
  ctx.fillText(label, left + width / 2, y + height * 0.69);
  ctx.textAlign = "left";
  ctx.letterSpacing = "0px";
  return width;
}

function multipleWidth(ctx: CanvasRenderingContext2D, text: string, height: number): number {
  ctx.font = font(800, height * 0.58);
  return numberWidth(ctx, text) + height * 0.9;
}

/** The "17x" pill: solid brand green on a win, outlined red below 1x. */
function multiplePill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, height: number, win: boolean): number {
  const width = multipleWidth(ctx, text, height);
  roundRect(ctx, x, y, width, height, height / 2);
  if (win) {
    ctx.fillStyle = C.brand;
    ctx.fill();
    ctx.fillStyle = "#03140D";
  } else {
    ctx.fillStyle = `rgba(${C.lossRgb}, 0.14)`;
    ctx.fill();
    ctx.strokeStyle = C.loss;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = C.loss;
  }
  ctx.font = font(800, height * 0.58);
  drawNumber(ctx, text, x + width / 2, y + height * 0.7, "center");
  return width;
}

function tagWidth(ctx: CanvasRenderingContext2D, tag: WalletTag, height: number): number {
  ctx.font = `${Math.round(height * 0.5)}px ${EMOJI}`;
  const emoji = ctx.measureText(tag.emoji).width;
  ctx.font = font(600, height * 0.46);
  return emoji + height * 0.25 + ctx.measureText(tag.label).width + height * 0.9;
}

/** Achievement chip: emoji and plain label on frosted glass. */
function tagPill(ctx: CanvasRenderingContext2D, tag: WalletTag, x: number, y: number, height: number): number {
  const width = tagWidth(ctx, tag, height);
  glassPill(ctx, x, y, width, height);
  ctx.font = `${Math.round(height * 0.5)}px ${EMOJI}`;
  ctx.fillStyle = C.text;
  ctx.fillText(tag.emoji, x + height * 0.45, y + height * 0.68);
  const emoji = ctx.measureText(tag.emoji).width;
  ctx.font = font(600, height * 0.46);
  ctx.fillText(tag.label, x + height * 0.45 + emoji + height * 0.25, y + height * 0.66);
  return width;
}

/** Identicon, short address and role, anchored left or right at a vertical centre. */
function walletBlock(ctx: CanvasRenderingContext2D, wallet: string, role: string, x: number, cy: number, size: number, align: "left" | "right", stacked: boolean): number {
  const avatar = size * 2.1;
  const gap = size * 0.55;
  ctx.font = font(500, size);
  const address = walletLabel(wallet);
  const addressW = ctx.measureText(address).width;
  const badgeH = size * 1.15;
  ctx.font = font(600, badgeH * 0.56);
  ctx.letterSpacing = `${(badgeH * 0.056).toFixed(1)}px`;
  const badgeW = ctx.measureText(role.toUpperCase()).width + badgeH * 0.8;
  ctx.letterSpacing = "0px";
  const textW = stacked ? Math.max(addressW, badgeW) : addressW + gap + badgeW;
  const total = avatar + gap + textW;
  const left = align === "right" ? x - total : x;
  drawIdenticon(ctx, wallet, align === "right" ? x - avatar : left, cy - avatar / 2, avatar);
  const textLeft = align === "right" ? x - avatar - gap - textW : left + avatar + gap;
  const textRight = textLeft + textW;
  ctx.font = font(500, size);
  ctx.fillStyle = C.text;
  if (stacked) {
    ctx.textAlign = align;
    ctx.fillText(address, align === "right" ? textRight : textLeft, cy - size * 0.18);
    ctx.textAlign = "left";
    roleBadge(ctx, role, align === "right" ? textRight : textLeft, cy + size * 0.22, badgeH, align);
  } else {
    ctx.fillText(address, textLeft, cy + size * 0.36);
    roleBadge(ctx, role, textLeft + addressW + gap, cy - badgeH / 2, badgeH, "left");
  }
  return total;
}

/** Text shrunk to fit a width; returns the drawn width. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, weight: number, size: number, color: string): number {
  ctx.font = font(weight, size);
  const width = ctx.measureText(text).width;
  const fit = Math.min(1, Math.max(maxW, 1) / Math.max(width, 1));
  ctx.font = font(weight, size * fit);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  return width * fit;
}

/** The hero PnL and its multiple pill, scaled together to fit. */
function pnlGroup(
  ctx: CanvasRenderingContext2D,
  text: string,
  multipleText: string | null,
  x: number,
  baseline: number,
  maxW: number,
  size: number,
  pillH: number,
  value: number,
  align: "left" | "right",
) {
  ctx.font = font(800, size);
  const numberW = numberWidth(ctx, text);
  const gap = pillH * 0.4;
  const pillW = multipleText ? multipleWidth(ctx, multipleText, pillH) : 0;
  const natural = numberW + (multipleText ? gap + pillW : 0);
  const fit = Math.min(1, Math.max(maxW, 1) / natural);
  const left = align === "right" ? x - natural * fit : x;
  ctx.font = font(800, size * fit);
  ctx.fillStyle = pnlColor(value);
  drawNumber(ctx, text, left, baseline);
  if (multipleText) {
    multiplePill(ctx, multipleText, left + (numberW + gap) * fit, baseline - size * fit * 0.36 - (pillH * fit) / 2, pillH * fit, value >= 0);
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
  // Entry: the average buy price so far, as a market cap when supply is known.
  const isBuy = (event: LedgerEvent) => event.kind === "buy";
  let entryPrice = scene.row.avgBuyPrice;
  if (scene.row.audit) {
    let quantity = 0;
    let value = 0;
    for (const event of currentEvents) {
      if (!isBuy(event)) continue;
      quantity += event.quantity;
      value += event.valueUsd;
    }
    entryPrice = quantity > 0 ? value / quantity : 0;
  } else if (!currentEvents.some(isBuy) && scene.events.some(isBuy)) {
    entryPrice = 0;
  }
  const entryCap = entryMarketCap(entryPrice, scene.circulatingSupply);
  const entry = entryCap !== null
    ? { label: "ENTRY MC", text: compactUsd(entryCap) }
    : { label: "AVG ENTRY", text: entryPrice > 0 ? formatPrice(entryPrice) : "—" };
  const role = scene.walletRole ?? "trader";
  const supply = scene.circulatingSupply ?? 0;
  const mcapAxis = scene.axis === "mcap" && supply > 0;
  const axisLabel = (price: number) => (mcapAxis ? compactUsd(price * supply) : formatPrice(price));

  // ── Header: token, wallet, PnL with its multiple, then the three stats ─
  const S = L.size;
  const H = L.header;
  ctx.textBaseline = "alphabetic";
  const pnlText = heroUsd(metrics.totalUsd);
  const liveMultiple = totalsUsd.bought > 0 ? (totalsUsd.bought + metrics.totalUsd) / totalsUsd.bought : null;
  const multipleText = formatMultiple(liveMultiple);
  const symbolText = `$${scene.symbol}`;
  const symbolX = H.x + S.token * 1.26;
  const symbolY = H.y + S.token / 2 + S.symbol * 0.36;
  drawTokenAvatar(ctx, scene.tokenLogo, scene.symbol, H.x, H.y, S.token);
  if (L.stackedHeader) {
    const walletW = walletBlock(ctx, scene.wallet, role, H.x + H.w, H.y + S.token / 2, S.wallet, "right", true);
    fitText(ctx, symbolText, symbolX, symbolY, H.x + H.w - walletW - S.wallet - symbolX, 700, S.symbol, C.text);
    const captionY = H.y + S.token + S.caption * 2.6;
    caption(ctx, "TOTAL PNL", H.x, captionY, S.caption);
    const baseline = captionY + S.pnl * 0.98;
    pnlGroup(ctx, pnlText, multipleText, H.x, baseline, H.w, S.pnl, S.pill, metrics.totalUsd, "left");
  } else {
    const symbolW = fitText(ctx, symbolText, symbolX, symbolY, H.w * 0.4, 700, S.symbol, C.text);
    const walletCy = H.y + S.token + S.wallet * 1.9;
    const walletW = walletBlock(ctx, scene.wallet, role, H.x, walletCy, S.wallet, "left", false);
    const leftW = Math.max(S.token * 1.26 + symbolW, walletW);
    const captionY = H.y + S.caption * 1.2;
    caption(ctx, "TOTAL PNL", H.x + H.w, captionY, S.caption, C.text3, "right");
    const baseline = captionY + S.pnl * 0.96;
    pnlGroup(ctx, pnlText, multipleText, H.x + H.w, baseline, H.w - leftW - S.pnl * 0.4, S.pnl, S.pill, metrics.totalUsd, "right");
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
    ctx.fillText(axisLabel(price), R.x + R.w, y - S.axis * 0.45);
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
    caption(ctx, mcapAxis ? `AVG ENTRY MC ${axisLabel(metrics.avgCostUsd)}` : `AVG COST ${axisLabel(metrics.avgCostUsd)}`, R.x, y - S.axis * 0.5, S.axis * 0.85, C.text3);
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
  const tag = mcapAxis ? `MC ${axisLabel(currentPrice)}` : axisLabel(currentPrice);
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
      const radius = Math.max(11, Math.min(20, slot * 0.42)) * (live ? 1.3 : 1);
      const draw = (side: "buy" | "sell") => {
        const up = side === "buy";
        const y = up ? yAt(candle.l) + radius * 1.9 : yAt(candle.h) - radius * 1.9;
        const rgb = up ? C.brandRgb : C.lossRgb;
        if (live) {
          ctx.fillStyle = `rgba(${rgb}, 0.2)`;
          ctx.beginPath();
          ctx.arc(x, y, radius * 2, 0, Math.PI * 2);
          ctx.fill();
        }
        // A short stem ties the badge to its candle.
        ctx.strokeStyle = `rgba(${rgb}, 0.55)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, up ? yAt(candle.l) + 3 : yAt(candle.h) - 3);
        ctx.lineTo(x, up ? y - radius : y + radius);
        ctx.stroke();
        sideBadge(ctx, x, y, radius, side);
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
    const widest = Math.max(...lines.map((line) => numberWidth(ctx, line.text))) + glyph * 2.6 + padX * 2;
    const fit = Math.min(1, (R.w * 0.92) / widest);
    ctx.scale(fit, fit);
    lines.forEach((line, index) => {
      ctx.font = font(700, S.label * 0.78);
      const textW = numberWidth(ctx, line.text);
      const pillW = textW + glyph * 2.6 + padX * 2;
      const y = lineGap * index;
      glassPill(ctx, -pillW / 2, y, pillW, pillH, line.rgb);
      sideBadge(ctx, -pillW / 2 + padX + glyph, y + pillH / 2, glyph * 1.1, line.color === C.brand ? "buy" : "sell");
      ctx.font = font(700, S.label * 0.78);
      ctx.fillStyle = line.color;
      drawNumber(ctx, line.text, -pillW / 2 + padX + glyph * 2.6, y + pillH * 0.68);
    });
    const fills = values.buys + values.sells;
    const sub = fills > 1
      ? [values.buys ? `${values.buys} buy${values.buys > 1 ? "s" : ""}` : "", values.sells ? `${values.sells} sell${values.sells > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ")
      : `at ${axisLabel(currentPrice)}${mcapAxis ? " MC" : ""}`;
    ctx.font = font(500, S.labelSub);
    ctx.fillStyle = C.text2;
    ctx.textAlign = "center";
    ctx.fillText(sub, 0, lineGap * (lines.length - 1) + pillH + S.labelSub * 1.35);
    ctx.textAlign = "left";
    ctx.restore();
  }

  // ── Bottom band: Invested, Entry MC, Sold, and the logo ──────────────
  const B = L.stats;
  const logoW = scene.logo && "width" in scene.logo && Number(scene.logo.width) > 0
    ? (S.logo * Number(scene.logo.width)) / Number(scene.logo.height || 1)
    : S.logo * 6;
  const cellsW = L.logoInBand ? B.w - logoW - S.statCaption * 2 : B.w;
  const cells = [
    { label: "INVESTED", side: "buy" as const, text: unitText(totals.bought), color: C.text },
    { label: entry.label, text: entry.text, color: C.text },
    { label: "SOLD", side: "sell" as const, text: unitText(totals.sold), color: totals.sold > 0 ? C.brand : C.text },
  ];
  const cellW = cellsW / cells.length;
  const captionBase = B.y + S.statCaption * 1.9;
  const valueBase = captionBase + S.statValue * 1.15;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(B.x, B.y);
  ctx.lineTo(B.x + B.w, B.y);
  for (let column = 1; column < cells.length; column += 1) {
    ctx.moveTo(B.x + column * cellW, B.y + S.statCaption * 0.9);
    ctx.lineTo(B.x + column * cellW, valueBase + S.statValue * 0.2);
  }
  ctx.stroke();
  cells.forEach((cell, index) => {
    const x = B.x + index * cellW + (index === 0 ? 0 : S.statCaption * 1.2);
    let captionX = x;
    if (cell.side) {
      const radius = S.statCaption * 0.62;
      sideBadge(ctx, x + radius, captionBase - S.statCaption * 0.36, radius, cell.side);
      captionX += radius * 2 + S.statCaption * 0.5;
    }
    caption(ctx, cell.label, captionX, captionBase, S.statCaption);
    ctx.font = font(700, S.statValue);
    const fit = Math.min(1, (cellW - S.statCaption * 2.4) / Math.max(numberWidth(ctx, cell.text), 1));
    ctx.font = font(700, S.statValue * fit);
    ctx.fillStyle = cell.color;
    drawNumber(ctx, cell.text, x, valueBase);
  });
  if (L.logoInBand) {
    drawLogo(ctx, scene.logo, B.x + B.w, (captionBase - S.statCaption + valueBase) / 2 - S.logo / 2, S.logo, "right");
  } else {
    drawLogo(ctx, scene.logo, B.x + B.w, valueBase + S.statValue * 0.75, S.logo, "right");
  }

  if (t >= timeline.replaySeconds) drawOutro(ctx, t, scene, L, { totals, totalsUsd, unitText, entry, role });
}

function drawLogo(ctx: CanvasRenderingContext2D, logo: CanvasImageSource | null, x: number, y: number, height: number, align: "left" | "right" | "center") {
  if (logo && "width" in logo && Number(logo.width) > 0) {
    const ratio = Number(logo.width) / Number(logo.height || 1);
    const width = height * ratio;
    const left = align === "right" ? x - width : align === "left" ? x : x - width / 2;
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

/**
 * Result card: the chart dims behind a framed card, the total counts up and
 * lands with a punch, then the multiple and the wallet's tags pop in one by
 * one. The last second is a still hold, so the final frame is the thumbnail.
 */
function drawOutro(
  ctx: CanvasRenderingContext2D,
  t: number,
  scene: VideoScene,
  L: Layout,
  values: {
    totals: { bought: number; sold: number };
    totalsUsd: { bought: number; sold: number };
    unitText: (value: number) => string;
    entry: { label: string; text: string };
    role: string;
  },
) {
  const { width: w, height: h } = ctx.canvas;
  const S = L.size;
  const K = L.card;
  const o = (t - scene.timeline.replaySeconds) / scene.timeline.outroSeconds;
  const veil = easeOutCubic(o / OUTRO.veil);
  ctx.fillStyle = `rgba(0, 0, 0, ${(0.975 * veil).toFixed(3)})`;
  ctx.fillRect(0, 0, w, h);

  const total = scene.row.totalUsd;
  const win = total >= 0;
  const appear = easeOutCubic((o - OUTRO.appearStart) / OUTRO.appearSpan);
  const count = easeOutCubic((o - OUTRO.countStart) / (OUTRO.countEnd - OUTRO.countStart));
  const slam = (o - OUTRO.countEnd) / OUTRO.slamSpan;
  const landed = slam >= 0;
  const punch = landed ? 1 + 0.12 * (1 - easeOutCubic(slam)) : 1;
  const shake = !win && landed && slam < 1 ? Math.sin(slam * Math.PI * 6) * (1 - slam) * 12 : 0;

  const glow = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.55);
  glow.addColorStop(0, `rgba(${win ? C.glow : "40, 40, 40"}, ${(0.75 * appear).toFixed(3)})`);
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  dotHorizon(ctx, w, h, appear, t);

  // ── Card geometry, top to bottom ──────────────────────────────────────
  const invested = values.totalsUsd.bought;
  const raw = invested > 0 ? (invested + total) / invested : null;
  const multiple = raw !== null && raw >= 0 ? raw : null;
  // Four figures only: what went in, where it entered, and the PnL split.
  const stats = [
    { label: "INVESTED", text: values.unitText(values.totals.bought * count), color: C.text },
    { label: values.entry.label, text: values.entry.text, color: C.text },
    { label: "REALIZED PNL", text: signedUsd(scene.row.realizedUsd * count), color: pnlColor(scene.row.realizedUsd) },
    { label: "UNREALIZED PNL", text: signedUsd(scene.row.unrealizedUsd * count), color: pnlColor(scene.row.unrealizedUsd) },
  ];
  const path = scene.pnlPath ?? [];
  const cardW = Math.min(w - L.pad * 2, K.maxW);
  const inner = cardW - K.pad * 2;
  const rowH = S.outroMeta * 1.9;
  const gap = S.outroMeta * 0.8;
  const pnlH = S.outroKicker * 1.9 + S.outroPnl;
  const chipH = S.outroMeta * 1.45;
  const statRows = Math.ceil(stats.length / K.columns);
  const statH = S.outroStat * 2.35;
  const curveH = path.length > 2 ? K.curve : 0;
  const footH = S.logo * 1.1;
  const cardH = K.pad * 2 + rowH + gap + pnlH + gap * 0.7 + chipH + gap + statRows * statH + (curveH ? gap * 0.6 + curveH : 0) + gap + footH;
  const fitScale = Math.min(1, (h - L.pad * 1.2) / cardH);

  ctx.save();
  ctx.globalAlpha = appear;
  ctx.translate(w / 2, h / 2 + (1 - appear) * 40);
  const scale = fitScale * (0.96 + 0.04 * appear);
  ctx.scale(scale, scale);
  const left = -cardW / 2;
  const top = -cardH / 2;
  const x0 = left + K.pad;
  const x1 = left + cardW - K.pad;

  roundRect(ctx, left, top, cardW, cardH, K.radius);
  ctx.fillStyle = "rgba(8, 11, 10, 0.94)";
  ctx.fill();
  const wash = ctx.createRadialGradient(0, top, 0, 0, top, cardW * 0.9);
  wash.addColorStop(0, `rgba(${win ? C.brandRgb : "120, 120, 120"}, 0.13)`);
  wash.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = wash;
  ctx.fill();
  const rim = ctx.createLinearGradient(left, top, left + cardW, top + cardH);
  if (win) {
    rim.addColorStop(0, "rgba(0, 255, 163, 0.95)");
    rim.addColorStop(0.5, "rgba(0, 150, 130, 0.3)");
    rim.addColorStop(1, "rgba(0, 255, 163, 0.65)");
  } else {
    rim.addColorStop(0, `rgba(${C.lossRgb}, 0.8)`);
    rim.addColorStop(0.5, "rgba(64, 64, 64, 0.5)");
    rim.addColorStop(1, `rgba(${C.lossRgb}, 0.45)`);
  }
  ctx.strokeStyle = rim;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Identity row: token on the left, wallet on the right.
  let y = top + K.pad;
  drawTokenAvatar(ctx, scene.tokenLogo, scene.symbol, x0, y, rowH);
  const walletW = walletBlock(ctx, scene.wallet, values.role, x1, y + rowH / 2, S.outroMeta * 0.7, "right", true);
  fitText(ctx, `$${scene.symbol}`, x0 + rowH * 1.25, y + rowH / 2 + S.outroMeta * 0.44, inner - rowH * 1.25 - walletW - S.outroMeta, 700, S.outroMeta * 1.25, C.text);
  y += rowH + gap;

  // Total PnL: count-up, punch, ring and sparks on a winning landing.
  caption(ctx, "TOTAL PNL", 0, y + S.outroKicker, S.outroKicker, C.text3, "center");
  const numberY = y + S.outroKicker * 1.9 + S.outroPnl * 0.5;
  if (landed && win && slam < 1.6) {
    const k = easeOutCubic(Math.min(1, slam / 1.6));
    ctx.strokeStyle = `rgba(${C.brandRgb}, ${(0.55 * (1 - k)).toFixed(3)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, numberY, S.outroPnl * (0.7 + 1.9 * k), 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 18; i += 1) {
      const jitter = Math.sin(i * 12.9898) * 0.5 + 0.5;
      const angle = (i / 18) * Math.PI * 2 + jitter * 0.4;
      const distance = S.outroPnl * (1 + jitter * 1.4) * k;
      const size = 4 + jitter * 6;
      ctx.fillStyle = i % 3 === 0 ? `rgba(255, 255, 255, ${(1 - k).toFixed(3)})` : `rgba(${C.brandRgb}, ${(1 - k).toFixed(3)})`;
      ctx.fillRect(Math.cos(angle) * distance * 1.6 - size / 2, numberY + Math.sin(angle) * distance - size / 2, size, size);
    }
  }
  ctx.save();
  ctx.translate(shake, numberY);
  ctx.scale(punch, punch);
  ctx.font = font(800, S.outroPnl);
  const fit = Math.min(1, inner / numberWidth(ctx, heroUsd(total)));
  ctx.font = font(800, S.outroPnl * fit);
  ctx.fillStyle = pnlColor(total);
  drawNumber(ctx, heroUsd(total * count), 0, S.outroPnl * fit * 0.36, "center");
  ctx.restore();
  y += pnlH + gap * 0.7;

  // The multiple counts with the total; tags pop in after the landing.
  const multipleText = formatMultiple(multiple === null ? null : 1 + (multiple - 1) * count);
  const tags = scene.tags ?? [];
  const widths = [
    ...(multipleText ? [multipleWidth(ctx, formatMultiple(multiple) ?? multipleText, chipH)] : []),
    ...tags.map((tag) => tagWidth(ctx, tag, chipH)),
  ];
  const chipGap = chipH * 0.3;
  const rowW = widths.reduce((sum, width) => sum + width, 0) + chipGap * Math.max(widths.length - 1, 0);
  if (widths.length > 0) {
    const chipScale = Math.min(1, inner / rowW);
    ctx.save();
    ctx.translate(0, y);
    ctx.scale(chipScale, chipScale);
    let chipX = -rowW / 2;
    if (multipleText) {
      multiplePill(ctx, multipleText, chipX + (widths[0]! - multipleWidth(ctx, multipleText, chipH)) / 2, 0, chipH, win);
      chipX += widths[0]! + chipGap;
    }
    tags.forEach((tag, index) => {
      const width = widths[index + (multipleText ? 1 : 0)]!;
      const pop = landed ? Math.min(1, Math.max(0, (slam - 0.4 - index * 0.5) / 0.9)) : 0;
      if (pop > 0) {
        const bounce = 1 + 0.18 * Math.sin(pop * Math.PI) * (1 - pop);
        ctx.save();
        ctx.globalAlpha *= easeOutCubic(pop * 1.6);
        ctx.translate(chipX + width / 2, chipH / 2);
        ctx.scale(bounce * (0.7 + 0.3 * easeOutCubic(pop)), bounce * (0.7 + 0.3 * easeOutCubic(pop)));
        tagPill(ctx, tag, -width / 2, -chipH / 2, chipH);
        ctx.restore();
      }
      chipX += width + chipGap;
    });
    ctx.restore();
  }
  y += chipH + gap;

  // Stats grid under a hairline.
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y - gap * 0.5);
  ctx.lineTo(x1, y - gap * 0.5);
  ctx.stroke();
  const cellW = inner / K.columns;
  stats.forEach((stat, index) => {
    const column = index % K.columns;
    const row = Math.floor(index / K.columns);
    const cx = x0 + cellW * (column + 0.5);
    const cy = y + row * statH;
    caption(ctx, stat.label, cx, cy + S.outroKicker * 0.8, S.outroKicker * 0.78, C.text3, "center");
    ctx.font = font(700, S.outroStat);
    const statFit = Math.min(1, (cellW * 0.9) / Math.max(numberWidth(ctx, stat.text), 1));
    ctx.font = font(700, S.outroStat * statFit);
    ctx.fillStyle = stat.color;
    drawNumber(ctx, stat.text, cx, cy + S.outroKicker * 0.8 + S.outroStat * 1.2, "center");
  });
  y += statRows * statH;

  // PnL across the replay, drawn on as the total counts up.
  if (curveH) {
    y += gap * 0.6;
    const labelH = S.outroKicker * 1.6;
    const all = [0, ...path.map((point) => point.totalUsd), total];
    const min = Math.min(...all);
    const max = Math.max(...all);
    const spread = Math.max(max - min, 1e-9);
    const tMax = scene.timeline.replaySeconds;
    const yOf = (value: number) => y + labelH + (1 - (value - min) / spread) * (curveH - labelH);
    caption(ctx, "PNL ACROSS THE REPLAY", x0, y + S.outroKicker * 0.7, S.outroKicker * 0.78, C.text3);
    const zeroY = yOf(0);
    ctx.strokeStyle = C.line;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(x0, zeroY);
    ctx.lineTo(x1, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);
    const points = [...path, { t: tMax, totalUsd: total }]
      .filter((point) => point.t <= tMax * count + 1e-9)
      .map((point) => ({ x: x0 + (point.t / tMax) * inner, y: yOf(point.totalUsd) }));
    if (points.length > 1) {
      const area = ctx.createLinearGradient(0, y, 0, y + curveH);
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
    y += curveH;
  }
  y += gap;

  // Footer: brand logo left, the app name right.
  drawLogo(ctx, scene.logo, x0, y + (footH - S.logo) / 2, S.logo, "left");
  ctx.font = font(500, S.footer * 0.9);
  ctx.fillStyle = C.text3;
  ctx.textAlign = "right";
  ctx.fillText("PnL Replayer · Powered by Birdeye Data API", x1, y + footH / 2 + S.footer * 0.32);
  ctx.textAlign = "left";
  ctx.restore();
}
