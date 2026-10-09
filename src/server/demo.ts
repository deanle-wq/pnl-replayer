import type { BirdeyeCandle } from "./birdeye/types";
import { calculateLedger, type LedgerEvent } from "./pnl/ledger";
import type { TokenAnalysis, BoardRow } from "./services/analyze-token";

const wallets = [
  "9xQeWvG816bUx9EPf5G7t8sMZyJ3qhYpK1nL2cV4bA6D",
  "7YttLkHDoViQW4cjoBZydPUnF6gFEoXv3mN8sR1aK5Jq",
  "4Nd1mLr2D8S7YpK6H3qZ9cV5bA1xEoTjWfUuGkP8sR2",
  "HwPp3oL8fT7dN2qK5vB9mS1xC6aZ4yEJgRuU8iVwQ3k",
  "2Fe47zbhYpQ8cM6vA1nR5sT9xK3dL7uEoW4gJqB8VfN",
  "A3ZcnXcC7pQ2mK9vN4sR6tY1dE8uL5gWjBfH3xVqP4a",
  "8WiUx5AhK2nV7cQ4mR9sT1yE6uP3dL5gBjF8xWvN2aZ",
  "BgKsDTAT9vQ4mN7sR2tY5uE1dL8gW3jF6xPpKcA4hVn",
  "CEikLmYN9dcDtHZC9qfwPpaUcLm3CNWMrR55Ub5mRyUn",
  "MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa",
];

function row(index: number, candles: BirdeyeCandle[]): BoardRow {
  const totals = [184_520, 72_430, 31_880, 9_210, 2_840, -1_760, -8_420, -27_310, -64_900, -142_800];
  const total = totals[index] ?? 0;
  const realized = total * (index % 3 === 0 ? 0.82 : 0.64);
  const holding = Math.max(0, 12_500_000 - index * 1_070_000);
  const audited = index < 6;
  const confidence = index < 3 ? "high" : index < 5 ? "medium" : "low";
  const base: BoardRow = {
    wallet: wallets[index]!,
    tags: index === 0 ? ["smart_trader"] : index === 3 ? ["sniper"] : index === 5 ? ["bundler"] : [],
    source: audited ? "audited-ledger" : "birdeye-wac",
    realizedUsd: realized,
    unrealizedUsd: total - realized,
    totalUsd: total,
    holding,
    boughtUsd: 24_000 + index * 8_300,
    soldUsd: 31_000 + Math.max(total, 0),
    buys: 3 + index * 2,
    sells: 2 + index,
    avgBuyPrice: 0.000021 + index * 0.0000012,
    avgSellPrice: 0.000034 - index * 0.0000008,
    // Kept on the demo chart so the wallet-window replay has candles to frame.
    firstTradeAt: candles[Math.min(candles.length - 1, 8 + index * 3)]!.unixTime,
    lastTradeAt: candles[Math.min(candles.length - 1, 150 + index * 2)]!.unixTime,
  };
  if (!audited) return base;
  const events: LedgerEvent[] = Array.from({ length: 14 }, (_, eventIndex) => {
    const candle = candles[Math.min(candles.length - 1, 8 + eventIndex * 12 + index)]!;
    const kind = eventIndex % 3 === 2 ? "sell" : "buy";
    const valueUsd = 1_800 + eventIndex * 430 + index * 170;
    const settlementSymbol = eventIndex % 2 === 0 ? "SOL" : "USDC";
    return {
      signature: `demo-${index}-${eventIndex}`,
      timestamp: candle.unixTime,
      kind,
      quantity: valueUsd / candle.c,
      priceUsd: candle.c,
      valueUsd,
      exactExecution: true,
      settlementSymbol,
      settlementAmount: settlementSymbol === "SOL" ? valueUsd / 145 : valueUsd,
      source: "demo",
    };
  });
  // Totals come from the ledger itself, so a replay of the sample walks to
  // exactly the number on the board instead of jumping at the end.
  const computed = calculateLedger(events, candles.at(-1)!.c);
  const ledger = {
    ...computed,
    exactExecutionRatio: index < 3 ? 0.99 : index < 5 ? 0.87 : 0.62,
    unknownBasisRatio: index < 3 ? 0.01 : index < 5 ? 0.11 : 0.28,
  };
  const birdeyeTotal = ledger.totalUsd * (index % 2 === 0 ? 0.91 : 1.13);
  return {
    ...base,
    realizedUsd: ledger.realizedUsd,
    unrealizedUsd: ledger.unrealizedUsd,
    totalUsd: ledger.totalUsd,
    holding: ledger.quantity,
    boughtUsd: ledger.boughtUsd,
    soldUsd: ledger.soldUsd,
    buys: ledger.buys,
    sells: ledger.sells,
    audit: {
      confidence,
      reasons: confidence === "high" ? [] : ["sample coverage warning"],
      birdeyeTotalUsd: birdeyeTotal,
      deltaUsd: ledger.totalUsd - birdeyeTotal,
      reconciledQuantityDelta: confidence === "low" ? holding * 0.08 : 0,
      exactExecutionRatio: ledger.exactExecutionRatio,
      unknownBasisRatio: ledger.unknownBasisRatio,
      truncated: confidence === "low",
      eventCount: 8 + index * 7,
      ledger,
    },
  };
}

export function demoAnalysis(): TokenAnalysis {
  const now = Math.floor(Date.now() / 1_000);
  let previousClose = 0.0000205;
  const candles = Array.from({ length: 180 }, (_, index) => {
    const trend = 0.000021 + index * 0.00000009;
    const wave = Math.sin(index / 9) * 0.000003 + Math.sin(index / 23) * 0.0000015;
    const close = Math.max(0.000004, trend + wave);
    const open = previousClose;
    const wick = 0.012 + Math.abs(Math.sin(index / 4)) * 0.012;
    previousClose = close;
    return {
      unixTime: now - (179 - index) * 3_600,
      o: open,
      h: Math.max(open, close) * (1 + wick),
      l: Math.min(open, close) * (1 - wick),
      c: close,
      v: 1_000_000 + Math.abs(Math.sin(index / 5)) * 8_000_000,
      type: "1H",
    };
  });
  return {
    demo: true,
    token: {
      mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      name: "Bonk — demo dataset",
      symbol: "BONK",
      decimals: 5,
    },
    generatedAt: now,
    methodology: "wac+balance-reconciliation",
    solPriceUsd: 145,
    spotPriceUsd: candles.at(-1)?.c ?? 0,
    market: { circulatingSupply: 88_000_000_000_000, marketCapUsd: (candles.at(-1)?.c ?? 0) * 88_000_000_000_000, holders: 1_000_000 },
    candles,
    board: wallets.map((_, index) => row(index, candles)).sort((a, b) => b.totalUsd - a.totalUsd),
    auditSummary: { requested: 6, completed: 6, high: 3, medium: 2, low: 1 },
  };
}
