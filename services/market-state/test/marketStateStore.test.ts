import test from "node:test";
import assert from "node:assert/strict";
import { MarketStateStore } from "../src/marketStateStore.js";
import type { UniverseMarketRecord } from "../src/contracts.js";

const market: UniverseMarketRecord = {
  market_id: "531202",
  event_id: "21662",
  market_complex_id: "event:21662",
  slug: "bitboy-convicted",
  question: "BitBoy convicted?",
  status: "active",
  active: true,
  accepting_orders: true,
  enable_order_book: true,
  approved: true,
  restricted: true,
  archived: false,
  closed: false,
  liquidity_usd: 2674.99,
  volume_24h_usd: 5146.76,
  volume_total_usd: 58365.48,
  spread_cents: 1,
  order_price_min_tick_size: 0.001,
  order_min_size: 5,
  end_date_utc: "2026-03-31T12:00:00Z",
  tags: ["crypto"],
  contracts: [
    {
      contract_id: "yes-token",
      outcome: "Yes",
      token_id: "yes-token",
      last_trade_price: 0.1425,
      best_bid: 0.14,
      best_ask: 0.145
    }
  ],
  ingest_source: "gamma-markets"
};

test("MarketStateStore converts book updates into market snapshot envelopes", () => {
  const store = new MarketStateStore("paper", [market]);
  const snapshot = store.handleBook({
    event_type: "book",
    asset_id: "yes-token",
    market: "condition-1",
    bids: [{ price: "0.41", size: "120" }],
    asks: [{ price: "0.43", size: "95" }],
    timestamp: "1766790415550"
  });

  assert.ok(snapshot);
  assert.equal(snapshot.payload.market_id, "531202");
  assert.equal(snapshot.payload.question, "BitBoy convicted?");
  assert.equal(snapshot.payload.slug, "bitboy-convicted");
  assert.equal(snapshot.payload.contract_id, "yes-token");
  assert.equal(snapshot.payload.outcome, "Yes");
  assert.equal(snapshot.payload.best_bid, 0.41);
  assert.equal(snapshot.payload.best_ask, 0.43);
  assert.equal(snapshot.payload.top_bid_size, 120);
  assert.equal(snapshot.payload.top_ask_size, 95);
  assert.equal(snapshot.payload.spread_cents, 2);
});

test("MarketStateStore marks market data stale when no updates arrive inside threshold", () => {
  const store = new MarketStateStore("paper", [market]);

  const stale = store.health(Date.parse("2026-03-06T12:00:06Z"), 5_000);
  assert.equal(stale.stale, true);
  assert.equal(stale.observed_contracts, 0);

  store.handleBestBidAsk({
    event_type: "best_bid_ask",
    asset_id: "yes-token",
    market: "condition-1",
    best_bid: "0.38",
    best_ask: "0.40",
    spread: "0.02",
    timestamp: "1772798400000"
  });

  const healthy = store.health(1772798404000, 5_000);
  assert.equal(healthy.stale, false);
  assert.equal(healthy.observed_contracts, 1);
  assert.equal(healthy.tracked_contracts, 1);
});

test("MarketStateStore updates last trade price from price change events", () => {
  const store = new MarketStateStore("paper", [market]);
  const [snapshot] = store.handlePriceChange({
    event_type: "price_change",
    market: "condition-1",
    timestamp: "1772798400000",
    price_changes: [
      {
        asset_id: "yes-token",
        price: "0.52",
        size: "15",
        side: "BUY",
        hash: "0xabc",
        best_bid: "0.51",
        best_ask: "0.53"
      }
    ]
  });

  assert.ok(snapshot);
  assert.equal(snapshot.payload.best_bid, 0.51);
  assert.equal(snapshot.payload.best_ask, 0.53);
  assert.equal(snapshot.payload.mid_price, 0.52);
});

test("MarketStateStore preserves sub-cent spreads", () => {
  const store = new MarketStateStore("paper", [market]);
  const snapshot = store.handleBestBidAsk({
    event_type: "best_bid_ask",
    asset_id: "yes-token",
    market: "condition-1",
    best_bid: "0.14",
    best_ask: "0.145",
    spread: "0.005",
    timestamp: "1772798400000"
  });

  assert.ok(snapshot);
  assert.equal(snapshot.payload.spread_cents, 0.5);
});
