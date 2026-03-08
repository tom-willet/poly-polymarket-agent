import test from "node:test";
import assert from "node:assert/strict";
import { runExecutionTick } from "../src/worker.js";
import type { ExecutionWorkerConfig } from "../src/config.js";
import type { CurrentStateStore, DecisionLedgerStore } from "@poly/openclaw-control";

class InMemoryCurrentStateStore implements CurrentStateStore {
  constructor(private readonly items = new Map<string, Record<string, unknown>>()) {}

  async get<T>(pk: string, sk: string): Promise<{ payload: T; ts_utc: string; event_type: string } | null> {
    return (this.items.get(`${pk}|${sk}`) as { payload: T; ts_utc: string; event_type: string } | undefined) ?? null;
  }

  async queryByPkPrefix(prefix: string): Promise<Array<{ pk: string; sk: string; payload: unknown; ts_utc: string }>> {
    return [...this.items.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => {
        const [pk, sk] = key.split("|");
        return {
          pk: pk!,
          sk: sk!,
          payload: value.payload,
          ts_utc: String(value.ts_utc ?? new Date().toISOString())
        };
      });
  }

  async put(pk: string, sk: string, item: Record<string, unknown>): Promise<void> {
    this.items.set(`${pk}|${sk}`, { ...item });
  }
}

class InMemoryDecisionLedgerStore implements DecisionLedgerStore {
  readonly items: Array<{ pk: string; sk: string; payload: unknown; ts_utc: string; event_type: string }> = [];

  async put(pk: string, sk: string, item: Record<string, unknown>): Promise<void> {
    this.items.push({
      pk,
      sk,
      payload: item.payload,
      ts_utc: String(item.ts_utc ?? new Date().toISOString()),
      event_type: String(item.event_type ?? "unknown")
    });
  }

  async query(): Promise<Array<{ pk: string; sk: string; payload: unknown; ts_utc: string; event_type: string }>> {
    return [];
  }
}

function config(): ExecutionWorkerConfig {
  return {
    env: "paper",
    currentStateTableName: "unused",
    decisionLedgerTableName: "unused",
    pollIntervalMs: 5_000,
    maxIntentsPerTick: 10
  };
}

test("execution worker persists heartbeat even with no intents", async () => {
  process.env.EXECUTION_HEARTBEAT_TIMEOUT_MS = "15000";
  const currentState = new InMemoryCurrentStateStore();
  const decisionLedger = new InMemoryDecisionLedgerStore();

  const summary = await runExecutionTick(config(), currentState, decisionLedger, new Date("2026-03-08T00:00:00Z"));

  assert.equal(summary.scanned_intents, 0);
  assert.equal(summary.heartbeat.healthy, true);
  const heartbeat = await currentState.get<{ healthy: boolean }>("health#execution-heartbeat", "latest");
  assert.equal(heartbeat?.event_type, "execution_heartbeat");
  assert.equal(heartbeat?.payload.healthy, true);
});

test("execution worker evaluates actions from persisted intents", async () => {
  process.env.EXECUTION_HEARTBEAT_TIMEOUT_MS = "15000";
  process.env.EXECUTION_INTENT_EXPIRY_SECONDS = "30";
  process.env.EXECUTION_PASSIVE_RESTING_MS = "3000";

  const currentState = new InMemoryCurrentStateStore(
    new Map([
      [
        "account#0xabc|snapshot",
        {
          ts_utc: "2026-03-08T00:00:00Z",
          event_type: "account_state_snapshot",
          payload: {
            user_address: "0xabc",
            funder_address: "0xabc",
            collateral: { balance: 1000, allowance: 1000 },
            open_order_count: 0,
            position_count: 0,
            recent_trade_count: 0,
            total_position_value_usd: 0,
            open_orders: []
          }
        }
      ],
      [
        "market#ct-yes|snapshot",
        {
          ts_utc: "2026-03-08T00:00:00Z",
          event_type: "market_snapshot",
          payload: {
            market_id: "mkt-1",
            contract_id: "ct-yes",
            market_complex_id: "event:1",
            status: "active",
            mid_price: 0.47,
            best_bid: 0.46,
            best_ask: 0.47,
            spread_cents: 1,
            top_bid_size: 100,
            top_ask_size: 100,
            time_to_resolution_hours: 24,
            book_ts_utc: "2026-03-08T00:00:00Z"
          }
        }
      ],
      [
        "market#ct-no|snapshot",
        {
          ts_utc: "2026-03-08T00:00:00Z",
          event_type: "market_snapshot",
          payload: {
            market_id: "mkt-1",
            contract_id: "ct-no",
            market_complex_id: "event:1",
            status: "active",
            mid_price: 0.48,
            best_bid: 0.47,
            best_ask: 0.48,
            spread_cents: 1,
            top_bid_size: 100,
            top_ask_size: 100,
            time_to_resolution_hours: 24,
            book_ts_utc: "2026-03-08T00:00:00Z"
          }
        }
      ],
      [
        "execution_intent#plan-1|latest",
        {
          ts_utc: "2026-03-08T00:00:00Z",
          event_type: "execution_intent",
          payload: {
            order_plan_id: "plan-1",
            decision_id: "decision-1",
            sleeve_id: "cross_market_core",
            market_complex_id: "event:1",
            execution_style: "passive_then_cross",
            max_notional_usd: 40,
            legs: [
              {
                market_id: "mkt-1",
                contract_id: "ct-yes",
                side: "buy",
                limit_price: 0.46,
                max_size: 43.478261
              },
              {
                market_id: "mkt-1",
                contract_id: "ct-no",
                side: "buy",
                limit_price: 0.47,
                max_size: 42.553191
              }
            ],
            expiry_utc: "2026-03-08T00:00:30Z",
            cancel_if_unfilled: true
          }
        }
      ]
    ])
  );
  const decisionLedger = new InMemoryDecisionLedgerStore();

  const summary = await runExecutionTick(config(), currentState, decisionLedger, new Date("2026-03-08T00:00:01Z"));

  assert.equal(summary.scanned_intents, 1);
  assert.equal(summary.action_updates, 1);
  const action = await currentState.get<{ status: string; actions: Array<{ action: string }> }>(
    "execution_action#plan-1",
    "latest"
  );
  assert.equal(action?.event_type, "execution_action");
  assert.equal(action?.payload.status, "ready");
  assert.equal(action?.payload.actions.length, 2);
  assert.equal(decisionLedger.items.some((item) => item.event_type === "execution_action"), true);
});
