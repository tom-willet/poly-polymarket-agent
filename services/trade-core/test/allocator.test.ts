import test from "node:test";
import assert from "node:assert/strict";
import { allocateProposals } from "../src/allocator.js";
import type { AllocationContext } from "../src/allocator.js";
import type { StrategyProposalPayload } from "../src/contracts.js";

function baseContext(): AllocationContext {
  return {
    config: {
      env: "paper",
      bankrollUsd: 1000,
      maxGrossExposureRatio: 0.7,
      maxSleeveExposureRatio: 0.35,
      maxMarketComplexExposureRatio: 0.2,
      maxContractExposureRatio: 0.12,
      maxInitialOrderSliceRatio: 0.05,
      maxActiveSleeves: 2
    },
    exposure: {
      grossReservedUsd: 0,
      sleeveReservedUsd: {},
      marketComplexReservedUsd: {},
      contractReservedUsd: {}
    }
  };
}

function proposal(overrides: Partial<StrategyProposalPayload> = {}): StrategyProposalPayload {
  return {
    proposal_id: "prop-1",
    sleeve_id: "cross_market_core",
    market_complex_id: "cx-1",
    thesis: "Linked contracts are misaligned after costs.",
    contracts: [
      {
        market_id: "mkt-a",
        contract_id: "ct-yes",
        side: "buy"
      },
      {
        market_id: "mkt-b",
        contract_id: "ct-no",
        side: "buy"
      }
    ],
    expected_edge_after_costs: 0.04,
    confidence: 0.75,
    max_holding_hours: 12,
    invalidators: ["edge closes"],
    sizing_hint_usd: 40,
    ...overrides
  };
}

test("allocator rejects malformed proposals", () => {
  const decisions = allocateProposals(
    [
      proposal({
        proposal_id: "",
        contracts: [],
        invalidators: []
      })
    ],
    baseContext()
  );

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.payload.status, "rejected");
  assert.match(decisions[0]?.payload.reason ?? "", /proposal_id is required/);
});

test("allocator ranks stronger proposals first and forwards them to risk", () => {
  const decisions = allocateProposals(
    [
      proposal({
        proposal_id: "low",
        expected_edge_after_costs: 0.03,
        confidence: 0.6
      }),
      proposal({
        proposal_id: "high",
        sleeve_id: "cross_market_alt",
        market_complex_id: "cx-2",
        expected_edge_after_costs: 0.05,
        confidence: 0.9
      })
    ],
    baseContext()
  );

  const forwarded = decisions.filter((decision) => decision.payload.status === "forwarded_to_risk");
  assert.equal(forwarded.length, 2);
  assert.equal(forwarded[0]?.payload.proposal_id, "high");
  assert.equal(forwarded[0]?.payload.rank, 1);
  assert.equal(forwarded[1]?.payload.proposal_id, "low");
  assert.equal(forwarded[1]?.payload.rank, 2);
});

test("allocator enforces active sleeve limit for new sleeves", () => {
  const context = baseContext();
  context.exposure.sleeveReservedUsd = {
    sleeve_a: 20,
    sleeve_b: 20
  };
  context.exposure.grossReservedUsd = 40;

  const decisions = allocateProposals(
    [
      proposal({
        proposal_id: "third-sleeve",
        sleeve_id: "sleeve_c"
      })
    ],
    context
  );

  assert.equal(decisions[0]?.payload.status, "rejected");
  assert.match(decisions[0]?.payload.reason ?? "", /active sleeve limit reached/);
});

test("allocator resizes proposals to fit bankroll limits", () => {
  const context = baseContext();
  context.exposure.grossReservedUsd = 660;
  const decisions = allocateProposals(
    [
      proposal({
        proposal_id: "resized",
        sizing_hint_usd: 100
      })
    ],
    context
  );

  assert.equal(decisions[0]?.payload.status, "forwarded_to_risk");
  assert.equal(decisions[0]?.payload.allocated_notional_usd, 40);
  assert.match(decisions[0]?.payload.reason ?? "", /resized/);
});
