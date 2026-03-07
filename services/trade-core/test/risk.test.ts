import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRisk, type RiskEvaluationInput, type RiskEvaluationContext } from "../src/risk.js";

function baseContext(): RiskEvaluationContext {
  return {
    env: "paper",
    allocatorConfig: {
      env: "paper",
      bankrollUsd: 1000,
      maxGrossExposureRatio: 0.7,
      maxSleeveExposureRatio: 0.35,
      maxMarketComplexExposureRatio: 0.2,
      maxContractExposureRatio: 0.12,
      maxInitialOrderSliceRatio: 0.05,
      maxActiveSleeves: 2
    },
    riskConfig: {
      maxDailyLossRatio: 0.075,
      maxWeeklyDrawdownRatio: 0.15,
      maxSpreadCents: 4,
      minTimeToResolutionHours: 4,
      maxTimeToResolutionHours: 45 * 24,
      minEdgeCents: 3,
      maxCostToGrossEdgeRatio: 0.5,
      minDepthMultiplier: 3,
      requireProdForLiveExecution: true
    }
  };
}

function baseInput(): RiskEvaluationInput {
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
    proposal: {
      proposal_id: "prop-1",
      sleeve_id: "cross_market_core",
      market_complex_id: "cx-1",
      contracts: [
        { market_id: "mkt-a", contract_id: "ct-yes", side: "buy" },
        { market_id: "mkt-b", contract_id: "ct-no", side: "buy" }
      ],
      expected_edge_after_costs: 0.05,
      confidence: 0.8,
      max_holding_hours: 12,
      invalidators: ["edge closes"],
      sizing_hint_usd: 40
    },
    marketState: [
      {
        market_id: "mkt-a",
        contract_id: "ct-yes",
        spread_cents: 2,
        top_bid_size: 100,
        top_ask_size: 100,
        time_to_resolution_hours: 12
      },
      {
        market_id: "mkt-b",
        contract_id: "ct-no",
        spread_cents: 2,
        top_bid_size: 100,
        top_ask_size: 100,
        time_to_resolution_hours: 12
      }
    ],
    systemHealth: {
      marketDataStale: false,
      accountStateStale: false,
      accountReconciliationOk: true,
      executionHeartbeatHealthy: true,
      walletBalanceMatches: true
    },
    operatorState: {
      paused: false,
      flattenRequested: false,
      liveExecutionRequested: false
    },
    performance: {
      dailyLossRatio: 0.01,
      weeklyDrawdownRatio: 0.02
    },
    estimatedTotalCostsUsd: 0.5
  };
}

test("risk kernel approves valid decisions", () => {
  const decision = evaluateRisk(baseInput(), baseContext());
  assert.equal(decision.payload.status, "approved");
  assert.equal(decision.payload.approved_notional_usd, 40);
});

test("risk kernel halts on stale market state", () => {
  const input = baseInput();
  input.systemHealth.marketDataStale = true;
  const decision = evaluateRisk(input, baseContext());
  assert.equal(decision.payload.status, "halted");
  assert.match(decision.payload.reason, /market state is stale/);
});

test("risk kernel rejects excessive spreads", () => {
  const input = baseInput();
  input.marketState[0]!.spread_cents = 8;
  input.marketState[1]!.spread_cents = 8;
  input.proposal.expected_edge_after_costs = 0.03;
  const decision = evaluateRisk(input, baseContext());
  assert.equal(decision.payload.status, "rejected");
  assert.match(decision.payload.reason, /spread exceeds limit/);
});

test("risk kernel rejects insufficient order book depth", () => {
  const input = baseInput();
  input.marketState[0]!.top_bid_size = 0;
  input.marketState[0]!.top_ask_size = 0;
  input.marketState[1]!.top_bid_size = 0;
  input.marketState[1]!.top_ask_size = 0;
  const decision = evaluateRisk(input, baseContext());
  assert.equal(decision.payload.status, "rejected");
  assert.match(decision.payload.reason, /top-of-book depth/);
});

test("risk kernel resizes to the initial slice cap", () => {
  const input = baseInput();
  input.allocatorDecision.allocated_notional_usd = 90;
  const decision = evaluateRisk(input, baseContext());
  assert.equal(decision.payload.status, "resized");
  assert.equal(decision.payload.approved_notional_usd, 50);
});
