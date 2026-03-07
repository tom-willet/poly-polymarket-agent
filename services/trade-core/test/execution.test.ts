import test from "node:test";
import assert from "node:assert/strict";
import { buildExecutionIntent } from "../src/execution.js";
import { evaluateExecutionAction } from "../src/executionPolicy.js";
import { HeartbeatManager } from "../src/heartbeat.js";
import { ExecutionReconciler } from "../src/reconciler.js";
import type { ExecutionPlanningInput } from "../src/execution.js";

function executionConfig() {
  return {
    intentExpirySeconds: 30,
    heartbeatSendIntervalMs: 5000,
    heartbeatTimeoutMs: 15000,
    passiveRestingMs: 3000
  };
}

function planningInput(): ExecutionPlanningInput {
  return {
    allocatorDecision: {
      decision_id: "dec-1",
      proposal_id: "prop-1",
      sleeve_id: "cross_market_core",
      rank: 1,
      requested_notional_usd: 40,
      allocated_notional_usd: 40,
      status: "forwarded_to_risk",
      reason: "ranked and funded"
    },
    riskDecision: {
      decision_id: "dec-1",
      proposal_id: "prop-1",
      status: "approved",
      approved_notional_usd: 40,
      checks: [],
      reason: "all hard risk checks passed"
    },
    proposal: {
      proposal_id: "prop-1",
      sleeve_id: "cross_market_core",
      market_complex_id: "cx-1",
      contracts: [
        { market_id: "mkt-a", contract_id: "ct-yes", side: "buy" },
        { market_id: "mkt-b", contract_id: "ct-no", side: "sell" }
      ],
      expected_edge_after_costs: 0.05,
      confidence: 0.8,
      max_holding_hours: 12,
      invalidators: ["edge closes"],
      sizing_hint_usd: 40
    },
    marketState: [
      { market_id: "mkt-a", contract_id: "ct-yes", best_bid: 0.49, best_ask: 0.51, spread_cents: 2 },
      { market_id: "mkt-b", contract_id: "ct-no", best_bid: 0.47, best_ask: 0.49, spread_cents: 2 }
    ]
  };
}

test("execution planner builds passive_then_cross intent from approved risk decision", () => {
  const intent = buildExecutionIntent(
    planningInput(),
    executionConfig(),
    "paper"
  );

  assert.equal(intent.payload.execution_style, "passive_then_cross");
  assert.equal(intent.payload.max_notional_usd, 40);
  assert.equal(intent.payload.legs.length, 2);
  assert.equal(intent.payload.legs[0]?.limit_price, 0.49);
  assert.equal(intent.payload.legs[1]?.limit_price, 0.49);
});

test("heartbeat manager chains heartbeat ids and detects stale acks", () => {
  const heartbeat = new HeartbeatManager(5000, 15000);
  assert.equal(heartbeat.shouldSend(0), true);
  assert.equal(heartbeat.nextHeartbeatPayload(0).heartbeat_id, "");
  heartbeat.recordAck("hb-1", 1000);
  assert.equal(heartbeat.shouldSend(2000), false);
  assert.equal(heartbeat.nextHeartbeatPayload(6000).heartbeat_id, "hb-1");
  assert.equal(heartbeat.health(12000).healthy, true);
  assert.equal(heartbeat.health(17001).healthy, false);
});

test("reconciler maps order and trade channel events into order_event envelopes", () => {
  const intent = buildExecutionIntent(
    planningInput(),
    executionConfig(),
    "paper"
  );
  const reconciler = new ExecutionReconciler("paper");
  reconciler.registerIntent(intent.payload);

  const [placement] = reconciler.ingest({
    event_type: "order",
    id: "ord-1",
    market: "mkt-a",
    asset_id: "ct-yes",
    side: "BUY",
    price: "0.49",
    original_size: "20",
    size_matched: "0",
    timestamp: "1772798400",
    type: "PLACEMENT"
  });
  assert.equal(placement?.payload.status, "placed");

  const [tradeUpdate] = reconciler.ingest({
    event_type: "trade",
    id: "trade-1",
    market: "mkt-a",
    asset_id: "ct-yes",
    side: "BUY",
    price: "0.49",
    size: "5",
    status: "MATCHED",
    matchtime: "1772798402",
    last_update: "1772798402",
    maker_orders: [
      {
        order_id: "ord-1",
        matched_amount: "5"
      }
    ]
  });
  assert.equal(tradeUpdate?.payload.status, "trade_update");
  assert.equal(tradeUpdate?.payload.filled_size, 5);
  assert.equal(reconciler.snapshot().open_orders, 1);
});

test("execution policy places passive orders before the passive window elapses", () => {
  const intent = buildExecutionIntent(planningInput(), executionConfig(), "paper");
  const action = evaluateExecutionAction(
    {
      intent,
      marketState: planningInput().marketState,
      orders: [],
      heartbeat: {
        active: false,
        healthy: false,
        last_sent_ts_utc: null,
        last_ack_ts_utc: null,
        heartbeat_id: null,
        timeout_ms: 15000
      },
      now_utc: intent.ts_utc
    },
    executionConfig()
  );

  assert.equal(action.payload.status, "ready");
  assert.equal(action.payload.actions.length, 2);
  assert.equal(action.payload.actions[0]?.action, "place_passive");
});

test("execution policy cancels resting passive orders after the dwell window", () => {
  const intent = buildExecutionIntent(planningInput(), executionConfig(), "paper");
  const action = evaluateExecutionAction(
    {
      intent,
      marketState: planningInput().marketState,
      orders: [
        {
          order_id: "ord-1",
          market_id: "mkt-a",
          contract_id: "ct-yes",
          side: "buy",
          limit_price: 0.49,
          original_size: 20,
          filled_size: 0,
          status: "open"
        }
      ],
      heartbeat: {
        active: true,
        healthy: true,
        last_sent_ts_utc: intent.ts_utc,
        last_ack_ts_utc: intent.ts_utc,
        heartbeat_id: "hb-1",
        timeout_ms: 15000
      },
      now_utc: new Date(Date.parse(intent.ts_utc) + 4000).toISOString()
    },
    executionConfig()
  );

  assert.equal(action.payload.status, "cancel_requested");
  assert.equal(action.payload.actions[0]?.action, "cancel");
  assert.equal(action.payload.actions[0]?.order_id, "ord-1");
});

test("execution policy crosses remaining size after passive orders are gone", () => {
  const intent = buildExecutionIntent(planningInput(), executionConfig(), "paper");
  const expectedRemaining = Number((intent.payload.legs[0]!.max_size - 5).toFixed(6));
  const action = evaluateExecutionAction(
    {
      intent,
      marketState: planningInput().marketState,
      orders: [
        {
          order_id: "ord-1",
          market_id: "mkt-a",
          contract_id: "ct-yes",
          side: "buy",
          limit_price: 0.49,
          original_size: 20,
          filled_size: 5,
          status: "cancelled"
        }
      ],
      heartbeat: {
        active: true,
        healthy: true,
        last_sent_ts_utc: intent.ts_utc,
        last_ack_ts_utc: intent.ts_utc,
        heartbeat_id: "hb-1",
        timeout_ms: 15000
      },
      now_utc: new Date(Date.parse(intent.ts_utc) + 4000).toISOString()
    },
    executionConfig()
  );

  assert.equal(action.payload.status, "ready");
  assert.equal(action.payload.actions[0]?.action, "place_cross");
  assert.equal(action.payload.actions[0]?.size, expectedRemaining);
});

test("execution policy halts when heartbeat is unhealthy", () => {
  const intent = buildExecutionIntent(planningInput(), executionConfig(), "paper");
  const action = evaluateExecutionAction(
    {
      intent,
      marketState: planningInput().marketState,
      orders: [],
      heartbeat: {
        active: true,
        healthy: false,
        last_sent_ts_utc: intent.ts_utc,
        last_ack_ts_utc: intent.ts_utc,
        heartbeat_id: "hb-1",
        timeout_ms: 15000
      }
    },
    executionConfig()
  );

  assert.equal(action.payload.status, "halted");
});
