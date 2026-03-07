import test from "node:test";
import assert from "node:assert/strict";
import { AccountStateStore } from "../src/accountStateStore.js";
import type { AccountStateSnapshotPayload } from "../src/accountSnapshot.js";

const snapshot: AccountStateSnapshotPayload = {
  user_address: "0xabc",
  funder_address: "0xabc",
  collateral: {
    asset_type: "COLLATERAL",
    token_id: null,
    balance: 125.5,
    allowance: 125.5
  },
  open_order_count: 1,
  position_count: 1,
  recent_trade_count: 2,
  total_position_value_usd: 44.25,
  open_orders: [
    {
      order_id: "order-1",
      market_id: "market-1",
      contract_id: "asset-1",
      side: "BUY",
      status: "LIVE",
      price: 0.42,
      original_size: 10,
      matched_size: 2,
      remaining_size: 8,
      outcome: "Yes",
      created_at_utc: "2026-03-06T20:00:00.000Z",
      expiration_utc: "2026-03-07T20:00:00.000Z"
    }
  ],
  positions: [
    {
      market_id: "market-1",
      contract_id: "asset-1",
      condition_id: "condition-1",
      outcome: "Yes",
      size: 5,
      avg_price: 0.4,
      current_price: 0.45,
      current_value_usd: 2.25,
      cash_pnl_usd: 0.25,
      redeemable: false,
      title: "Will X happen?",
      slug: "will-x-happen",
      event_slug: "event-x",
      end_date_utc: "2026-03-31T12:00:00.000Z"
    }
  ],
  recent_trades: [
    {
      trade_id: "trade-1",
      market_id: "market-1",
      contract_id: "asset-1",
      side: "BUY",
      price: 0.42,
      size: 2,
      status: "MATCHED",
      outcome: "Yes",
      match_time_utc: "2026-03-06T20:01:00.000Z",
      last_update_utc: "2026-03-06T20:01:00.000Z",
      trader_side: "MAKER",
      transaction_hash: "0x123"
    },
    {
      trade_id: "trade-2",
      market_id: "market-1",
      contract_id: "asset-1",
      side: "BUY",
      price: 0.43,
      size: 1,
      status: "MATCHED",
      outcome: "Yes",
      match_time_utc: "2026-03-06T20:02:00.000Z",
      last_update_utc: "2026-03-06T20:02:00.000Z",
      trader_side: "TAKER",
      transaction_hash: "0x456"
    }
  ]
};

test("AccountStateStore emits healthy account state after a successful refresh", () => {
  const store = new AccountStateStore("paper");
  const envelope = store.apply(snapshot, Date.parse("2026-03-06T20:05:00Z"));

  assert.equal(envelope.payload.open_order_count, 1);
  assert.equal(envelope.payload.position_count, 1);

  const health = store.health(Date.parse("2026-03-06T20:05:04Z"), 15_000);
  assert.equal(health.payload.stale, false);
  assert.equal(health.payload.reconciliation_ok, true);
  assert.deepEqual(health.payload.issues, []);
});

test("AccountStateStore reports structural issues and refresh failures", () => {
  const store = new AccountStateStore("paper");
  store.apply(
    {
      ...snapshot,
      collateral: { ...snapshot.collateral, allowance: null },
      open_orders: [
        snapshot.open_orders[0],
        { ...snapshot.open_orders[0] }
      ],
      open_order_count: 2
    },
    Date.parse("2026-03-06T20:05:00Z")
  );
  store.recordFailure("network timeout");

  const health = store.health(Date.parse("2026-03-06T20:05:20Z"), 15_000);
  assert.equal(health.payload.stale, true);
  assert.equal(health.payload.reconciliation_ok, false);
  assert.ok(health.payload.issues.includes("collateral allowance missing"));
  assert.ok(health.payload.issues.includes("duplicate open order id: order-1"));
  assert.ok(health.payload.issues[0]?.includes("network timeout"));
});
