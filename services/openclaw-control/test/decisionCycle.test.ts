import test from "node:test";
import assert from "node:assert/strict";
import { runDecisionCycle } from "../src/decisionCycle.js";
import type { CurrentStateStore, DecisionLedgerStore } from "../src/store.js";
import type { CurrentStateReader } from "@poly/trade-core";

class InMemoryCurrentStateStore implements CurrentStateStore, CurrentStateReader {
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

  async put(): Promise<void> {
    throw new Error("not implemented");
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

  async query(
    pk: string,
    limit = 5
  ): Promise<Array<{ pk: string; sk: string; payload: unknown; ts_utc: string; event_type: string }>> {
    return this.items.filter((item) => item.pk === pk).slice(-limit).reverse();
  }
}

function currentState(): InMemoryCurrentStateStore {
  return new InMemoryCurrentStateStore(
    new Map([
      [
        "health#market-data|latest",
        {
          ts_utc: "2026-03-07T04:00:00Z",
          event_type: "market_data_health",
          payload: {
            stale: false
          }
        }
      ],
      [
        "account#0xabc|snapshot",
        {
          ts_utc: "2026-03-07T04:00:00Z",
          event_type: "account_state_snapshot",
          payload: {
            user_address: "0xabc",
            funder_address: "0xabc",
            collateral: {
              balance: 500,
              allowance: 500
            },
            open_order_count: 0,
            position_count: 0,
            recent_trade_count: 0,
            total_position_value_usd: 0
          }
        }
      ],
      [
        "account#0xabc|health",
        {
          ts_utc: "2026-03-07T04:00:00Z",
          event_type: "account_state_health",
          payload: {
            stale: false,
            reconciliation_ok: true,
            open_order_count: 0,
            position_count: 0,
            recent_trade_count: 0
          }
        }
      ],
      [
        "market#ct-yes|snapshot",
        {
          ts_utc: "2026-03-07T04:00:00Z",
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
            book_ts_utc: "2026-03-07T04:00:00Z"
          }
        }
      ],
      [
        "market#ct-no|snapshot",
        {
          ts_utc: "2026-03-07T04:00:00Z",
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
            book_ts_utc: "2026-03-07T04:00:00Z"
          }
        }
      ]
    ])
  );
}

test("decision cycle produces proposal, allocator decision, risk decision, and execution intent", async () => {
  process.env.RUNTIME_MODE = "paper";
  process.env.BANKROLL_USD = "1000";
  process.env.MAX_GROSS_EXPOSURE_RATIO = "0.7";
  process.env.MAX_SLEEVE_EXPOSURE_RATIO = "0.35";
  process.env.MAX_MARKET_COMPLEX_EXPOSURE_RATIO = "0.2";
  process.env.MAX_CONTRACT_EXPOSURE_RATIO = "0.12";
  process.env.MAX_INITIAL_ORDER_SLICE_RATIO = "0.05";
  process.env.MAX_ACTIVE_SLEEVES = "2";
  process.env.MAX_DAILY_LOSS_RATIO = "0.075";
  process.env.MAX_WEEKLY_DRAWDOWN_RATIO = "0.15";
  process.env.MAX_SPREAD_CENTS = "4";
  process.env.MIN_TIME_TO_RESOLUTION_HOURS = "4";
  process.env.MAX_TIME_TO_RESOLUTION_HOURS = String(45 * 24);
  process.env.MIN_EDGE_CENTS = "3";
  process.env.MAX_COST_TO_GROSS_EDGE_RATIO = "0.5";
  process.env.MIN_DEPTH_MULTIPLIER = "3";
  process.env.EXECUTION_INTENT_EXPIRY_SECONDS = "30";
  process.env.EXECUTION_HEARTBEAT_SEND_INTERVAL_MS = "5000";
  process.env.EXECUTION_HEARTBEAT_TIMEOUT_MS = "15000";
  process.env.PROPOSAL_MIN_EDGE_CENTS = "3";
  process.env.PROPOSAL_MAX_SPREAD_CENTS = "4";
  process.env.PROPOSAL_COST_PER_LEG_CENTS = "1";
  process.env.PROPOSAL_DEFAULT_HOLDING_HOURS = "24";
  process.env.PROPOSAL_SIZING_HINT_USD = "40";

  const store = currentState();
  const decisionLedger = new InMemoryDecisionLedgerStore();
  const cycle = await runDecisionCycle({
    env: "paper",
    config: {
      env: "paper",
      currentStateTableName: "unused",
      decisionLedgerTableName: "unused",
      defaultMode: "paper",
      proposalMinEdgeCents: 3,
      proposalMaxSpreadCents: 4,
      proposalCostPerLegCents: 1,
      proposalDefaultHoldingHours: 24,
      proposalSizingHintUsd: 40
    },
    currentState: store,
    currentStateReader: store,
    decisionLedger
  });

  assert.equal(cycle.payload.proposal_count, 1);
  assert.equal(cycle.payload.allocator_decision_count, 1);
  assert.equal(cycle.payload.risk_decision_count, 1);
  assert.equal(cycle.payload.execution_intent_count, 1);
  assert.equal(decisionLedger.items.length, 5);
  assert.equal(decisionLedger.items.some((item) => item.event_type === "strategy_proposal"), true);
  assert.equal(decisionLedger.items.some((item) => item.event_type === "allocator_decision"), true);
  assert.equal(decisionLedger.items.some((item) => item.event_type === "risk_decision"), true);
  assert.equal(decisionLedger.items.some((item) => item.event_type === "execution_intent"), true);
  assert.equal(decisionLedger.items.some((item) => item.event_type === "decision_cycle"), true);
});
