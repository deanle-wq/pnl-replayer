import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { walletReplay } from "../src/server/services/wallet-replay";

const MINT = "MintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const T0 = 1_700_000_000;
const DAY = 86_400;
const SOL = "So11111111111111111111111111111111111111112";

interface Call {
  path: string;
  query: URLSearchParams;
}

let calls: Call[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  process.env.BIRDEYE_API_KEY = "test-key";
  process.env.CACHE_TTL_SECONDS = "0";
  process.env.BIRDEYE_MAX_RETRIES = "0";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function serve(routes: Record<string, (query: URLSearchParams) => unknown>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ path: url.pathname, query: url.searchParams });
    const route = routes[url.pathname];
    if (!route) return new Response(JSON.stringify({ message: `unrouted ${url.pathname}` }), { status: 404 });
    return new Response(JSON.stringify(route(url.searchParams)), { status: 200 });
  }) as typeof fetch;
}

function change(wallet: string, signature: string, timestamp: number, before: number, after: number) {
  return {
    tx_hash: signature,
    block_unix_time: timestamp,
    address: wallet,
    token_account: "ata",
    pre_balance: String(before * 1e6),
    post_balance: String(after * 1e6),
    amount: String((after - before) * 1e6),
    token_info: { address: MINT, decimals: 6 },
  };
}

function swap(wallet: string, signature: string, timestamp: number, side: "buy" | "sell", quantity: number, usd?: number) {
  return {
    tx_hash: signature,
    block_unix_time: timestamp,
    owner: wallet,
    side,
    tx_type: side,
    ins_index: 0,
    volume_usd: usd,
    source: "test_dex",
    from: side === "sell"
      ? { address: MINT, ui_change_amount: -quantity, ui_amount: quantity }
      : { address: SOL, symbol: "SOL", ui_change_amount: -(usd ?? 0) / 100, ui_amount: (usd ?? 0) / 100 },
    to: side === "buy"
      ? { address: MINT, ui_change_amount: quantity, ui_amount: quantity }
      : { address: SOL, symbol: "SOL", ui_change_amount: (usd ?? 0) / 100, ui_amount: (usd ?? 0) / 100 },
  };
}

function tradesRoute(trades: ReturnType<typeof swap>[]) {
  return (query: URLSearchParams) => {
    const after = Number(query.get("after_time"));
    const before = Number(query.get("before_time"));
    const side = query.get("tx_type");
    const offset = Number(query.get("offset"));
    const limit = Number(query.get("limit"));
    const matched = trades
      .filter((trade) => trade.block_unix_time >= after && trade.block_unix_time <= before)
      .filter((trade) => side === "swap" || trade.side === side)
      .sort((a, b) => b.block_unix_time - a.block_unix_time);
    const items = matched.slice(offset, offset + limit);
    return { data: { items, has_next: offset + items.length < matched.length } };
  };
}

test("replay builds the full ledger: pre-trade transfers, late sells and only active buckets", async () => {
  const wallet = "WalletLedger1111111111111111111111111111111";
  const changes = [
    change(wallet, "gift", T0 - 40 * DAY, 0, 2),
    change(wallet, "buy", T0, 2, 12),
    // After Top Traders' (stale) lastTradeUnixTime. Must still be a sell.
    change(wallet, "sell", T0 + 60 * DAY, 12, 8),
  ];
  const trades = [swap(wallet, "buy", T0, "buy", 10, 100), swap(wallet, "sell", T0 + 60 * DAY, "sell", 4, 60)];
  serve({
    "/wallet/v2/pnl/multiple": () => ({
      data: { data: { [wallet]: { counts: { total_buy: 1, total_sell: 1 }, quantity: { holding: 8 }, pnl: { total_usd: 70 } } } },
    }),
    "/defi/price": () => ({ data: { value: 20 } }),
    "/wallet/v2/balance-change": (query) => ({ data: { items: Number(query.get("offset")) === 0 ? changes : [] } }),
    "/defi/v3/token/txs": tradesRoute(trades),
  });

  const result = await walletReplay({ mint: MINT, wallet, firstTradeAt: T0, lastTradeAt: T0 });
  assert.equal(result.mode, "ledger");
  const audit = result.row.audit!;
  assert.deepEqual(audit.ledger.events.map((event) => event.kind), ["transfer_in", "buy", "sell"]);
  assert.equal(audit.truncated, false);
  assert.equal(audit.reconciledQuantityDelta, 0);
  assert.equal(audit.spotPriceUsd, 20);
  assert.equal(result.row.holding, 8);
  assert.equal(audit.birdeyeTotalUsd, 70);

  const balanceCall = calls.find((call) => call.path === "/wallet/v2/balance-change")!;
  assert.equal(Number(balanceCall.query.get("time_from")), 1_609_459_200);
  const tradeWindows = new Set(
    calls.filter((call) => call.path === "/defi/v3/token/txs").map((call) => call.query.get("after_time")),
  );
  assert.equal(tradeWindows.size, 3, "one 29-day bucket per month that has a balance change");
  for (const call of calls.filter((item) => item.path === "/defi/v3/token/txs")) {
    assert.ok(Number(call.query.get("before_time")) - Number(call.query.get("after_time")) < 30 * DAY);
  }
  assert.equal(calls.some((call) => call.path === "/defi/v3/ohlcv"), false, "priced swaps need no fallback candles");
});

test("an unpriced swap fetches fallback candles once instead of booking a free buy", async () => {
  const wallet = "WalletUnpriced11111111111111111111111111111";
  serve({
    "/wallet/v2/pnl/multiple": () => ({ data: { data: {} } }),
    "/defi/price": () => ({ data: { value: 3 } }),
    "/wallet/v2/balance-change": (query) => ({
      data: { items: Number(query.get("offset")) === 0 ? [change(wallet, "buy", T0, 0, 10)] : [] },
    }),
    "/defi/v3/token/txs": tradesRoute([{ ...swap(wallet, "buy", T0, "buy", 10), to: { address: MINT, ui_change_amount: 10, ui_amount: 10 } }]),
    "/defi/v3/ohlcv": () => ({ data: { items: [{ unix_time: T0 - 3_600, o: 2, h: 2, l: 2, c: 2, v: 1 }] } }),
  });

  const result = await walletReplay({ mint: MINT, wallet });
  assert.equal(result.mode, "ledger");
  const buy = result.row.audit!.ledger.events[0]!;
  assert.equal(buy.kind, "buy");
  assert.equal(buy.priceUsd, 2);
  assert.equal(buy.exactExecution, false);
  assert.equal(calls.filter((call) => call.path === "/defi/v3/ohlcv").length, 1);
  assert.equal(result.row.audit!.ledger.unrealizedUsd, 10);
});

test("heavy wallets sample their own span and read buys and sells separately", async () => {
  const wallet = "WalletHeavy111111111111111111111111111111111";
  const first = T0;
  const last = T0 + 100 * DAY;
  const trades = [
    ...Array.from({ length: 150 }, (_, index) => swap(wallet, `buy-${index}`, last - 10 * DAY + index, "buy", 1, 1)),
    swap(wallet, "lonely-sell", last - 10 * DAY - 500, "sell", 50, 75),
  ];
  serve({
    "/wallet/v2/pnl/multiple": () => ({
      data: { data: { [wallet]: { counts: { total_buy: 5_900, total_sell: 1_100 }, quantity: { holding: 100 }, pnl: { total_usd: 1 } } } },
    }),
    "/defi/price": () => ({ data: { value: 1 } }),
    "/defi/v3/token/txs": tradesRoute(trades),
  });

  const result = await walletReplay({ mint: MINT, wallet, firstTradeAt: first, lastTradeAt: last });
  assert.equal(result.mode, "sample");
  if (result.mode !== "sample") return;
  assert.equal(calls.some((call) => call.path === "/wallet/v2/balance-change"), false);
  const tradeCalls = calls.filter((call) => call.path === "/defi/v3/token/txs");
  assert.ok(tradeCalls.every((call) => ["buy", "sell"].includes(call.query.get("tx_type") ?? "")));
  assert.equal(tradeCalls.filter((call) => call.query.get("tx_type") === "buy").length, result.windows);
  assert.equal(tradeCalls.filter((call) => call.query.get("tx_type") === "sell").length, result.windows);
  for (const call of tradeCalls) {
    assert.ok(Number(call.query.get("after_time")) >= first - 3_600);
    assert.ok(Number(call.query.get("before_time")) <= last + 3_600);
  }
  assert.ok(result.events.some((event) => event.signature === "lonely-sell" && event.kind === "sell"));
  assert.equal(result.sampled, true, "a full buy page is reported as a sample");
});
