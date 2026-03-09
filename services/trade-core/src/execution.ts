import type {
  AllocatorDecisionPayload,
  EventEnvelope,
  ExecutionIntentPayload,
  RiskDecisionPayload,
  StrategyProposalPayload
} from "./contracts.js";
import type { ExecutionConfig } from "./executionConfig.js";

export interface ExecutionMarketState {
  market_id: string;
  contract_id: string;
  best_bid: number | null;
  best_ask: number | null;
  spread_cents: number | null;
  top_bid_size: number | null;
  top_ask_size: number | null;
}

export interface ExecutionPlanningInput {
  allocatorDecision: AllocatorDecisionPayload;
  riskDecision: RiskDecisionPayload;
  proposal: StrategyProposalPayload;
  marketState: ExecutionMarketState[];
}

function roundPrice(value: number): number {
  return Number(value.toFixed(4));
}

function roundSize(value: number): number {
  return Number(value.toFixed(6));
}

function buildEnvelope(
  env: "sim" | "paper" | "prod",
  payload: ExecutionIntentPayload
): EventEnvelope<ExecutionIntentPayload> {
  return {
    schema_version: "v1",
    env,
    event_type: "execution_intent",
    service: "trade-core",
    trace_id: crypto.randomUUID(),
    ts_utc: new Date().toISOString(),
    payload
  };
}

export function buildExecutionIntent(
  input: ExecutionPlanningInput,
  config: ExecutionConfig,
  env: "sim" | "paper" | "prod"
): EventEnvelope<ExecutionIntentPayload> {
  if (!["approved", "resized"].includes(input.riskDecision.status)) {
    throw new Error(`Risk decision status "${input.riskDecision.status}" cannot produce an execution intent`);
  }

  const marketByContract = new Map(
    input.marketState.map((state) => [`${state.market_id}:${state.contract_id}`, state] as const)
  );

  const executionStyle: ExecutionIntentPayload["execution_style"] = input.marketState.every(
    (state) => state.spread_cents !== null && state.spread_cents <= 2
  )
    ? "passive_then_cross"
    : "cross_only";

  const perLegNotional = input.riskDecision.approved_notional_usd / Math.max(1, input.proposal.contracts.length);
  const legs = input.proposal.contracts.map((contract) => {
    const state = marketByContract.get(`${contract.market_id}:${contract.contract_id}`);
    if (!state) {
      throw new Error(`Missing execution market state for ${contract.market_id}:${contract.contract_id}`);
    }

    const limitPrice =
      executionStyle === "passive_then_cross"
        ? contract.side === "buy"
          ? state.best_bid ?? state.best_ask
          : state.best_ask ?? state.best_bid
        : contract.side === "buy"
          ? state.best_ask ?? state.best_bid
          : state.best_bid ?? state.best_ask;

    if (limitPrice === null || limitPrice <= 0) {
      throw new Error(`No valid price available for ${contract.market_id}:${contract.contract_id}`);
    }

    return {
      market_id: contract.market_id,
      contract_id: contract.contract_id,
      side: contract.side,
      limit_price: roundPrice(limitPrice),
      max_size: roundSize(perLegNotional / limitPrice)
    };
  });

  const now = Date.now();
  return buildEnvelope(env, {
    order_plan_id: crypto.randomUUID(),
    decision_id: input.allocatorDecision.decision_id,
    sleeve_id: input.allocatorDecision.sleeve_id,
    market_complex_id: input.proposal.market_complex_id,
    execution_style: executionStyle,
    max_notional_usd: roundPrice(input.riskDecision.approved_notional_usd),
    legs,
    expiry_utc: new Date(now + config.intentExpirySeconds * 1000).toISOString(),
    cancel_if_unfilled: true
  });
}
