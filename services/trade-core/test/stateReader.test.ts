import test from "node:test";
import assert from "node:assert/strict";
import {
  assembleExecutionPlanningInputFromState,
  assembleRiskInputFromState,
  type CurrentStateReader
} from "../src/stateReader.js";

class InMemoryCurrentStateReader implements CurrentStateReader {
  constructor(private readonly items: Map<string, { payload: unknown }>) {}

  async get<T>(pk: string, sk: string): Promise<{ payload: T } | null> {
    return (this.items.get(`${pk}|${sk}`) as { payload: T } | undefined) ?? null;
  }
}

function reader(): CurrentStateReader {
  return new InMemoryCurrentStateReader(
    new Map([
      [
        "market#ct-yes|snapshot",
        {
          payload: {
            market_id: "mkt-a",
            contract_id: "ct-yes",
            spread_cents: 2,
            best_bid: 0.49,
            best_ask: 0.51,
            top_bid_size: 100,
            top_ask_size: 120,
            time_to_resolution_hours: 12
          }
        }
      ],
      [
        "market#ct-no|snapshot",
        {
          payload: {
            market_id: "mkt-b",
            contract_id: "ct-no",
            spread_cents: 2,
            best_bid: 0.47,
            best_ask: 0.49,
            top_bid_size: 90,
            top_ask_size: 110,
            time_to_resolution_hours: 12
          }
        }
      ],
      [
        "health#market-data|latest",
        {
          payload: {
            stale: false
          }
        }
      ],
      [
        "account#0xabc|health",
        {
          payload: {
            stale: false,
            reconciliation_ok: true
          }
        }
      ],
      [
        "account#0xabc|snapshot",
        {
          payload: {
            user_address: "0xabc",
            collateral: {
              balance: 500,
              allowance: 500
            }
          }
        }
      ]
    ])
  );
}

function proposal() {
  return {
    proposal_id: "prop-1",
    sleeve_id: "cross_market_core",
    market_complex_id: "cx-1",
    contracts: [
      { market_id: "mkt-a", contract_id: "ct-yes", side: "buy" as const },
      { market_id: "mkt-b", contract_id: "ct-no", side: "sell" as const }
    ],
    expected_edge_after_costs: 0.05,
    confidence: 0.8,
    max_holding_hours: 12,
    invalidators: ["edge closes"],
    sizing_hint_usd: 40
  };
}

function allocatorDecision() {
  return {
    decision_id: "dec-1",
    proposal_id: "prop-1",
    sleeve_id: "cross_market_core",
    rank: 1,
    requested_notional_usd: 40,
    allocated_notional_usd: 40,
    status: "forwarded_to_risk" as const,
    reason: "ranked and funded"
  };
}

test("assembleRiskInputFromState hydrates market and health state from current state", async () => {
  const input = await assembleRiskInputFromState(reader(), {
    allocatorDecision: allocatorDecision(),
    proposal: proposal(),
    accountUserAddress: "0xabc",
    operatorState: {
      paused: false,
      flattenRequested: false,
      liveExecutionRequested: false
    },
    performance: {
      dailyLossRatio: 0.01,
      weeklyDrawdownRatio: 0.02
    },
    estimatedTotalCostsUsd: 0.5,
    executionHeartbeatHealthy: true
  });

  assert.equal(input.marketState.length, 2);
  assert.equal(input.systemHealth.marketDataStale, false);
  assert.equal(input.systemHealth.accountStateStale, false);
  assert.equal(input.systemHealth.accountReconciliationOk, true);
  assert.equal(input.systemHealth.executionHeartbeatHealthy, true);
});

test("assembleExecutionPlanningInputFromState hydrates execution book state from current state", async () => {
  const input = await assembleExecutionPlanningInputFromState(reader(), {
    allocatorDecision: allocatorDecision(),
    proposal: proposal(),
    accountUserAddress: "0xabc",
    riskDecision: {
      decision_id: "dec-1",
      proposal_id: "prop-1",
      status: "approved",
      approved_notional_usd: 40,
      checks: [],
      reason: "all good"
    }
  });

  assert.equal(input.marketState.length, 2);
  assert.equal(input.marketState[0]?.best_bid, 0.49);
  assert.equal(input.marketState[1]?.best_ask, 0.49);
});
