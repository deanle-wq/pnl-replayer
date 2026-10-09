import { BirdeyeClient } from "../birdeye/client";
import type { BirdeyeTrade } from "../birdeye/types";
import type { ApiUsage } from "../birdeye/usage";
import { buildTradeReplayEvents, type LedgerEvent } from "../pnl/ledger";
import { builtInRows, rowFromBuiltIn, type BoardRow } from "./analyze-token";
import { auditWalletRow, HISTORY_FLOOR, tradeKey } from "./wallet-ledger";

const WINDOW_SECONDS = 29 * 86_400;
const MAX_SAMPLE_WINDOWS = 36;

export type WalletReplay =
  | {
    /** Full balance-change ledger, graded the same way as the board audit. */
    mode: "ledger";
    row: BoardRow;
    requests: number;
    elapsedMs: number;
    usage: ApiUsage;
  }
  | {
    /** Wallet too active for a full read: decoded swaps only, Birdeye WAC totals. */
    mode: "sample";
    row: BoardRow;
    events: LedgerEvent[];
    sampled: boolean;
    windows: number;
    requests: number;
    elapsedMs: number;
    usage: ApiUsage;
    reason: string;
  };

/** Spread `count` picks across `items`, always keeping both ends. */
function spread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, index) =>
    items[Math.round((index / Math.max(count - 1, 1)) * (items.length - 1))]!,
  );
}

export async function walletReplay(options: {
  mint: string;
  wallet: string;
  firstTradeAt?: number;
  lastTradeAt?: number;
  /** Defaults to the deployment's BIRDEYE_API_KEY. */
  apiKey?: string;
}): Promise<WalletReplay> {
  const started = Date.now();
  const client = new BirdeyeClient(options.apiKey ?? process.env.BIRDEYE_API_KEY ?? "");
  const maxEvents = Number(process.env.AUDIT_MAX_EVENTS ?? 10_000);
  const maxTrades = Number(process.env.AUDIT_MAX_TRADES ?? 5_000);
  const now = Math.floor(Date.now() / 1_000);
  const { mint, wallet } = options;

  // Same price URL as the board, so within the cache TTL both mark open
  // inventory at the identical spot.
  const [pnlResponse, spotPriceUsd] = await Promise.all([
    client.walletPnlMultiple(mint, [wallet]),
    client.tokenPrice(mint),
  ]);
  const baseline = rowFromBuiltIn(
    { owner: wallet, firstTradeUnixTime: options.firstTradeAt, lastTradeUnixTime: options.lastTradeAt },
    builtInRows(pnlResponse)[wallet] ?? {},
  );

  const expectedTrades = baseline.buys + baseline.sells;
  if (expectedTrades <= maxTrades) {
    const audited = await auditWalletRow({ client, mint, row: baseline, to: now, spotPriceUsd, maxEvents });
    return {
      mode: "ledger",
      row: audited.row,
      requests: audited.requests + 2,
      elapsedMs: Date.now() - started,
      usage: client.usage(),
    };
  }

  // A wallet with thousands of fills cannot be read in full per click. Sample
  // its own active span (not the token's), and read each side separately so a
  // burst of buys can never push the sells out of the page.
  const to = Math.min(now, Math.floor((options.lastTradeAt ?? now) + 3_600));
  const from = Math.max(HISTORY_FLOOR, Math.min(to, Math.floor((options.firstTradeAt ?? to - MAX_SAMPLE_WINDOWS * WINDOW_SECONDS) - 3_600)));
  const allWindows: Array<{ from: number; to: number }> = [];
  for (let end = to; end > from; end -= WINDOW_SECONDS) {
    allWindows.push({ from: Math.max(from, end - WINDOW_SECONDS + 1), to: end });
  }
  if (allWindows.length === 0) allWindows.push({ from, to });
  const windows = spread(allWindows, MAX_SAMPLE_WINDOWS);
  const pages = await Promise.all(
    windows.flatMap((window) => (["buy", "sell"] as const).map((side) =>
      client.tokenWalletTradesPage(mint, wallet, window.from, window.to, 0, 100, side),
    )),
  );
  const trades = new Map<string, BirdeyeTrade>();
  for (const page of pages) {
    for (const trade of page.items) trades.set(tradeKey(trade), trade);
  }

  return {
    mode: "sample",
    row: baseline,
    events: buildTradeReplayEvents([...trades.values()], mint),
    sampled: windows.length < allWindows.length || pages.some((page) => page.hasNext),
    windows: windows.length,
    requests: pages.length + 2,
    elapsedMs: Date.now() - started,
    usage: client.usage(),
    reason: `${expectedTrades.toLocaleString("en-US")} Birdeye trades exceeds the ${maxTrades.toLocaleString("en-US")}-trade full-ledger limit`,
  };
}
