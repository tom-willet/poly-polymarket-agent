import test from "node:test";
import assert from "node:assert/strict";
import { archiveKeyForCommand, currentStateKeyForEnvelope } from "../src/stateKeys.js";

test("currentStateKeyForEnvelope routes market snapshots by contract", () => {
  const key = currentStateKeyForEnvelope({
    schema_version: "v1",
    env: "paper",
    event_type: "market_snapshot",
    service: "market-state",
    trace_id: "trace-1",
    ts_utc: "2026-03-06T20:00:00Z",
    payload: {
      market_id: "m1",
      event_id: "e1",
      slug: "market-one",
      question: "Market one?",
      contract_id: "c1",
      outcome: "Yes",
      market_complex_id: "cx1",
      status: "active",
      mid_price: 0.5,
      best_bid: 0.49,
      best_ask: 0.51,
      spread_cents: 2,
      top_bid_size: 1,
      top_ask_size: 1,
      time_to_resolution_hours: 12,
      book_ts_utc: "2026-03-06T20:00:00Z"
    }
  });

  assert.deepEqual(key, { pk: "market#c1", sk: "snapshot" });
});

test("currentStateKeyForEnvelope does not route universe snapshots into DynamoDB current state", () => {
  const key = currentStateKeyForEnvelope({
    schema_version: "v1",
    env: "paper",
    event_type: "market_universe_snapshot",
    service: "market-state",
    trace_id: "trace-1",
    ts_utc: "2026-03-06T20:00:00Z",
    payload: {
      market_count: 1,
      fetched_pages: 1,
      gamma_base_url: "https://gamma-api.polymarket.com",
      markets: []
    }
  });

  assert.equal(key, null);
});

test("currentStateKeyForEnvelope routes account health by account address", () => {
  const key = currentStateKeyForEnvelope(
    {
      schema_version: "v1",
      env: "paper",
      event_type: "account_state_health",
      service: "market-state",
      trace_id: "trace-1",
      ts_utc: "2026-03-06T20:00:00Z",
      payload: {
        last_success_ts_utc: "2026-03-06T20:00:00Z",
        stale_threshold_ms: 15000,
        stale: false,
        reconciliation_ok: true,
        issues: [],
        open_order_count: 0,
        position_count: 0,
        recent_trade_count: 0
      }
    },
    "0xabc"
  );

  assert.deepEqual(key, { pk: "account#0xabc", sk: "health" });
});

test("currentStateKeyForEnvelope routes position snapshots by wallet and market complex", () => {
  const key = currentStateKeyForEnvelope({
    schema_version: "v1",
    env: "paper",
    event_type: "position_snapshot",
    service: "market-state",
    trace_id: "trace-1",
    ts_utc: "2026-03-06T20:00:00Z",
    payload: {
      wallet_id: "0xabc",
      sleeve_id: "cross_market_core",
      market_complex_id: "event:event-x",
      gross_exposure_usd: 12.34,
      net_exposure_usd: 12.34,
      realized_pnl_usd: 1.23,
      unrealized_pnl_usd: -0.45,
      open_orders_reserved_usd: 0,
      snapshot_ts_utc: "2026-03-06T20:00:00Z"
    }
  });

  assert.deepEqual(key, { pk: "position#0xabc#event:event-x", sk: "snapshot" });
});

test("archiveKeyForCommand partitions by env and day", () => {
  const key = archiveKeyForCommand("paper", "market-state", "stream", Date.parse("2026-03-06T20:01:02Z"));
  assert.equal(key, "market-state/paper/2026/03/06/stream/2026-03-06T20-01-02.000Z.ndjson");
});
