import type { AllocatorConfig } from "./config.js";
import type {
  AllocatorDecisionPayload,
  EventEnvelope,
  RiskCheckPayload,
  RiskDecisionPayload,
  StrategyProposalPayload
} from "./contracts.js";
import type { RiskConfig } from "./riskConfig.js";

export interface RiskMarketState {
  market_id: string;
  contract_id: string;
  spread_cents: number | null;
  top_bid_size: number | null;
  top_ask_size: number | null;
  time_to_resolution_hours: number | null;
}

export interface SystemHealthState {
  marketDataStale: boolean;
  accountStateStale: boolean;
  accountReconciliationOk: boolean;
  executionHeartbeatHealthy: boolean;
  walletBalanceMatches: boolean;
}

export interface OperatorState {
  paused: boolean;
  flattenRequested: boolean;
  liveExecutionRequested: boolean;
}

export interface PerformanceState {
  dailyLossRatio: number;
  weeklyDrawdownRatio: number;
}

export interface RiskEvaluationInput {
  allocatorDecision: AllocatorDecisionPayload;
  proposal: StrategyProposalPayload;
  marketState: RiskMarketState[];
  systemHealth: SystemHealthState;
  operatorState: OperatorState;
  performance: PerformanceState;
  estimatedTotalCostsUsd?: number;
}

export interface RiskEvaluationContext {
  env: AllocatorConfig["env"];
  allocatorConfig: AllocatorConfig;
  riskConfig: RiskConfig;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(2));
}

function buildDecision(
  env: RiskEvaluationContext["env"],
  payload: RiskDecisionPayload
): EventEnvelope<RiskDecisionPayload> {
  return {
    schema_version: "v1",
    env,
    event_type: "risk_decision",
    service: "trade-core",
    trace_id: crypto.randomUUID(),
    ts_utc: new Date().toISOString(),
    payload
  };
}

function pushCheck(checks: RiskCheckPayload[], name: string, pass: boolean): boolean {
  checks.push({
    name,
    result: pass ? "pass" : "fail"
  });

  return pass;
}

function haltReason(input: RiskEvaluationInput, context: RiskEvaluationContext, checks: RiskCheckPayload[]): string | null {
  const { operatorState, systemHealth, performance } = input;
  if (!pushCheck(checks, "operator_pause", !operatorState.paused)) {
    return "operator pause is active";
  }
  if (!pushCheck(checks, "operator_flatten", !operatorState.flattenRequested)) {
    return "flatten requested by operator";
  }
  if (!pushCheck(checks, "market_state_fresh", !systemHealth.marketDataStale)) {
    return "canonical market state is stale";
  }
  if (!pushCheck(checks, "account_state_fresh", !systemHealth.accountStateStale)) {
    return "account state is stale";
  }
  if (!pushCheck(checks, "account_reconciliation", systemHealth.accountReconciliationOk)) {
    return "account reconciliation failed";
  }
  if (!pushCheck(checks, "execution_heartbeat", systemHealth.executionHeartbeatHealthy)) {
    return "execution heartbeat is degraded";
  }
  if (!pushCheck(checks, "wallet_balance_match", systemHealth.walletBalanceMatches)) {
    return "wallet balance mismatch detected";
  }
  if (!pushCheck(checks, "daily_drawdown_limit", performance.dailyLossRatio < context.riskConfig.maxDailyLossRatio)) {
    return "daily loss limit breached";
  }
  if (
    !pushCheck(
      checks,
      "weekly_drawdown_limit",
      performance.weeklyDrawdownRatio < context.riskConfig.maxWeeklyDrawdownRatio
    )
  ) {
    return "weekly drawdown limit breached";
  }
  if (
    !pushCheck(
      checks,
      "prod_mode_for_live_execution",
      !operatorState.liveExecutionRequested ||
        !context.riskConfig.requireProdForLiveExecution ||
        context.env === "prod"
    )
  ) {
    return "live execution requested outside prod";
  }

  return null;
}

export function evaluateRisk(
  input: RiskEvaluationInput,
  context: RiskEvaluationContext
): EventEnvelope<RiskDecisionPayload> {
  const checks: RiskCheckPayload[] = [];

  if (input.allocatorDecision.status !== "forwarded_to_risk") {
    return buildDecision(context.env, {
      decision_id: input.allocatorDecision.decision_id,
      proposal_id: input.allocatorDecision.proposal_id,
      status: "rejected",
      approved_notional_usd: 0,
      checks: [
        {
          name: "allocator_forwarded",
          result: "fail"
        }
      ],
      reason: "allocator decision was not forwarded to risk"
    });
  }

  const halt = haltReason(input, context, checks);
  if (halt) {
    return buildDecision(context.env, {
      decision_id: input.allocatorDecision.decision_id,
      proposal_id: input.allocatorDecision.proposal_id,
      status: "halted",
      approved_notional_usd: 0,
      checks,
      reason: halt
    });
  }

  const proposal = input.proposal;
  const allocatedUsd = input.allocatorDecision.allocated_notional_usd;
  const edgeCents = proposal.expected_edge_after_costs * 100;
  const grossEdgeUsd = proposal.expected_edge_after_costs * allocatedUsd;
  const estimatedCostsUsd = input.estimatedTotalCostsUsd ?? 0;
  const legCount = Math.max(1, proposal.contracts.length);

  if (!pushCheck(checks, "positive_edge_after_costs", proposal.expected_edge_after_costs > 0)) {
    return buildDecision(context.env, {
      decision_id: input.allocatorDecision.decision_id,
      proposal_id: input.allocatorDecision.proposal_id,
      status: "rejected",
      approved_notional_usd: 0,
      checks,
      reason: "proposal edge after costs is not positive"
    });
  }

  if (!pushCheck(checks, "minimum_edge_threshold", edgeCents >= context.riskConfig.minEdgeCents)) {
    return buildDecision(context.env, {
      decision_id: input.allocatorDecision.decision_id,
      proposal_id: input.allocatorDecision.proposal_id,
      status: "rejected",
      approved_notional_usd: 0,
      checks,
      reason: "edge does not clear the minimum threshold"
    });
  }

  if (!pushCheck(checks, "has_invalidators", proposal.invalidators.length > 0)) {
    return buildDecision(context.env, {
      decision_id: input.allocatorDecision.decision_id,
      proposal_id: input.allocatorDecision.proposal_id,
      status: "rejected",
      approved_notional_usd: 0,
      checks,
      reason: "proposal has no invalidators"
    });
  }

  if (
    !pushCheck(
      checks,
      "resolution_window",
      proposal.max_holding_hours >= context.riskConfig.minTimeToResolutionHours &&
        proposal.max_holding_hours <= context.riskConfig.maxTimeToResolutionHours
    )
  ) {
    return buildDecision(context.env, {
      decision_id: input.allocatorDecision.decision_id,
      proposal_id: input.allocatorDecision.proposal_id,
      status: "rejected",
      approved_notional_usd: 0,
      checks,
      reason: "proposal holding horizon is outside the allowed range"
    });
  }

  const byContract = new Map(
    input.marketState.map((state) => [`${state.market_id}:${state.contract_id}`, state] as const)
  );
  let depthLimitedNotionalUsd = Number.POSITIVE_INFINITY;
  for (const leg of proposal.contracts) {
    const state = byContract.get(`${leg.market_id}:${leg.contract_id}`);
    const hasState = state !== undefined;
    if (!pushCheck(checks, `market_state_available:${leg.contract_id}`, hasState)) {
      return buildDecision(context.env, {
        decision_id: input.allocatorDecision.decision_id,
        proposal_id: input.allocatorDecision.proposal_id,
        status: "rejected",
        approved_notional_usd: 0,
        checks,
        reason: `missing market state for ${leg.contract_id}`
      });
    }

    const spreadPass =
      (state!.spread_cents ?? Number.POSITIVE_INFINITY) <= context.riskConfig.maxSpreadCents ||
      edgeCents > (state!.spread_cents ?? Number.POSITIVE_INFINITY);
    if (!pushCheck(checks, `spread_limit:${leg.contract_id}`, spreadPass)) {
      return buildDecision(context.env, {
        decision_id: input.allocatorDecision.decision_id,
        proposal_id: input.allocatorDecision.proposal_id,
        status: "rejected",
        approved_notional_usd: 0,
        checks,
        reason: `spread exceeds limit for ${leg.contract_id}`
      });
    }

    const depth = Math.min(state!.top_bid_size ?? 0, state!.top_ask_size ?? 0);
    const depthCapUsd = (depth * legCount) / context.riskConfig.minDepthMultiplier;
    depthLimitedNotionalUsd = Math.min(depthLimitedNotionalUsd, depthCapUsd);
    if (!pushCheck(checks, `book_depth:${leg.contract_id}`, depthCapUsd >= allocatedUsd)) {
      if (depthCapUsd <= 0) {
        return buildDecision(context.env, {
          decision_id: input.allocatorDecision.decision_id,
          proposal_id: input.allocatorDecision.proposal_id,
          status: "rejected",
          approved_notional_usd: 0,
          checks,
          reason: `top-of-book depth is insufficient for ${leg.contract_id}`
        });
      }
    }

    if (
      !pushCheck(
        checks,
        `time_to_resolution:${leg.contract_id}`,
        state!.time_to_resolution_hours === null ||
          (state!.time_to_resolution_hours >= context.riskConfig.minTimeToResolutionHours &&
            state!.time_to_resolution_hours <= context.riskConfig.maxTimeToResolutionHours)
      )
    ) {
      return buildDecision(context.env, {
        decision_id: input.allocatorDecision.decision_id,
        proposal_id: input.allocatorDecision.proposal_id,
        status: "rejected",
        approved_notional_usd: 0,
        checks,
        reason: `time to resolution is outside limits for ${leg.contract_id}`
      });
    }
  }

  if (
    !pushCheck(
      checks,
      "cost_to_gross_edge",
      grossEdgeUsd <= 0 || estimatedCostsUsd <= grossEdgeUsd * context.riskConfig.maxCostToGrossEdgeRatio
    )
  ) {
    return buildDecision(context.env, {
      decision_id: input.allocatorDecision.decision_id,
      proposal_id: input.allocatorDecision.proposal_id,
      status: "rejected",
      approved_notional_usd: 0,
      checks,
      reason: "estimated costs consume too much gross edge"
    });
  }

  const initialSliceCapUsd = context.allocatorConfig.bankrollUsd * context.allocatorConfig.maxInitialOrderSliceRatio;
  const approvedNotionalUsd = roundUsd(Math.min(allocatedUsd, initialSliceCapUsd, depthLimitedNotionalUsd));
  const status: RiskDecisionPayload["status"] = approvedNotionalUsd < allocatedUsd ? "resized" : "approved";

  return buildDecision(context.env, {
    decision_id: input.allocatorDecision.decision_id,
    proposal_id: input.allocatorDecision.proposal_id,
    status,
    approved_notional_usd: approvedNotionalUsd,
    checks,
    reason:
      status === "resized" ? "risk kernel resized notional to the strictest active risk cap" : "all hard risk checks passed"
  });
}
