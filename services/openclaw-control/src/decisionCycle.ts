import {
  allocateProposals,
  assembleExecutionPlanningInputFromState,
  assembleRiskInputFromState,
  buildExecutionIntent,
  evaluateRisk,
  loadAllocatorConfig,
  loadExecutionConfig,
  loadRiskConfig,
  type CurrentStateReader,
  type EventEnvelope as TradeCoreEnvelope,
  type ExecutionIntentPayload,
  type RiskDecisionPayload,
  type StrategyProposalPayload as TradeCoreProposalPayload
} from "@poly/trade-core";
import type { ControlConfig } from "./config.js";
import type { DecisionCyclePayload, EventEnvelope, StrategyProposalPayload } from "./contracts.js";
import { generateCrossMarketConsistencyProposals } from "./proposals.js";
import type { AccountSnapshotPayload, CurrentStateStore, DecisionLedgerStore } from "./store.js";
import { loadOperatorState } from "./store.js";

export interface DecisionCycleContext {
  env: "sim" | "paper" | "prod";
  config: ControlConfig;
  currentState: CurrentStateStore;
  currentStateReader: CurrentStateReader;
  decisionLedger: DecisionLedgerStore;
}

function envelope(
  env: DecisionCycleContext["env"],
  payload: DecisionCyclePayload
): EventEnvelope<DecisionCyclePayload> {
  return {
    schema_version: "v1",
    env,
    event_type: "decision_cycle",
    service: "openclaw-control",
    trace_id: crypto.randomUUID(),
    ts_utc: new Date().toISOString(),
    payload
  };
}

async function persistLedgerEnvelope<T>(
  ledger: DecisionLedgerStore,
  env: DecisionCycleContext["env"],
  eventType: string,
  entityId: string,
  tsUtc: string,
  payload: T
): Promise<void> {
  await ledger.put(`${eventType}#${entityId}`, tsUtc, {
    schema_version: "v1",
    env,
    event_type: eventType,
    service: "openclaw-control",
    trace_id: crypto.randomUUID(),
    ts_utc: tsUtc,
    payload
  });
}

function toTradeCoreProposal(proposal: StrategyProposalPayload): TradeCoreProposalPayload {
  return proposal;
}

async function selectAccountUserAddress(currentState: CurrentStateStore): Promise<string> {
  const accounts = await currentState.queryByPkPrefix("account#");
  const snapshots = accounts.filter((item) => item.sk === "snapshot");
  if (snapshots.length === 0) {
    throw new Error("No account snapshot available for decision cycle");
  }

  const payload = snapshots[0]?.payload as AccountSnapshotPayload | undefined;
  if (!payload?.user_address) {
    throw new Error("Account snapshot is missing user_address");
  }

  return payload.user_address;
}

export async function runDecisionCycle(
  context: DecisionCycleContext
): Promise<EventEnvelope<DecisionCyclePayload>> {
  const operatorState = await loadOperatorState(context.currentState, context.config.defaultMode);
  const proposalEnvelopes = await generateCrossMarketConsistencyProposals({
    env: context.env,
    config: context.config,
    currentState: context.currentState
  });
  const proposals = proposalEnvelopes.map((entry) => entry.payload);

  if (proposals.length === 0) {
    const cycleEnvelope = envelope(context.env, {
      proposal_count: 0,
      allocator_decision_count: 0,
      risk_decision_count: 0,
      execution_intent_count: 0,
      notes: [
        "no eligible cross-market consistency proposals found",
        `operator paused=${operatorState.paused}`,
        `operator flatten_requested=${operatorState.flatten_requested}`
      ],
      proposals: [],
      allocator_decisions: [],
      risk_decisions: [],
      execution_intents: []
    });
    await persistLedgerEnvelope(
      context.decisionLedger,
      context.env,
      "decision_cycle",
      cycleEnvelope.trace_id,
      cycleEnvelope.ts_utc,
      cycleEnvelope.payload
    );
    return cycleEnvelope;
  }

  const allocatorConfig = loadAllocatorConfig();
  const allocatorDecisions = allocateProposals(
    proposals.map((proposal) => toTradeCoreProposal(proposal)),
    {
      config: allocatorConfig,
      exposure: {
        grossReservedUsd: 0,
        sleeveReservedUsd: {},
        marketComplexReservedUsd: {},
        contractReservedUsd: {}
      }
    }
  );

  const riskConfig = loadRiskConfig();
  const executionConfig = loadExecutionConfig();
  const accountUserAddress = await selectAccountUserAddress(context.currentState);
  const riskDecisions: Array<TradeCoreEnvelope<RiskDecisionPayload>> = [];
  const executionIntents: Array<TradeCoreEnvelope<ExecutionIntentPayload>> = [];

  for (const allocatorDecision of allocatorDecisions) {
    if (allocatorDecision.payload.status !== "forwarded_to_risk") {
      continue;
    }

    const proposal = proposals.find((entry) => entry.proposal_id === allocatorDecision.payload.proposal_id);
    if (!proposal) {
      continue;
    }

    const riskInput = await assembleRiskInputFromState(context.currentStateReader, {
      allocatorDecision: allocatorDecision.payload,
      proposal: toTradeCoreProposal(proposal),
      accountUserAddress,
      operatorState: {
        paused: operatorState.paused,
        flattenRequested: operatorState.flatten_requested,
        liveExecutionRequested: false
      },
      performance: {
        dailyLossRatio: 0,
        weeklyDrawdownRatio: 0
      },
      estimatedTotalCostsUsd: 0,
      executionHeartbeatHealthy: true
    });

    const riskDecision = evaluateRisk(riskInput, {
      env: context.env,
      allocatorConfig,
      riskConfig
    });
    riskDecisions.push(riskDecision);

    if (!["approved", "resized"].includes(riskDecision.payload.status)) {
      continue;
    }

    const executionPlanningInput = await assembleExecutionPlanningInputFromState(context.currentStateReader, {
      allocatorDecision: allocatorDecision.payload,
      proposal: toTradeCoreProposal(proposal),
      accountUserAddress,
      riskDecision: riskDecision.payload as RiskDecisionPayload & { status: "approved" | "resized" }
    });

    executionIntents.push(buildExecutionIntent(executionPlanningInput, executionConfig, context.env));
  }

  const cycleEnvelope = envelope(context.env, {
    proposal_count: proposals.length,
    allocator_decision_count: allocatorDecisions.length,
    risk_decision_count: riskDecisions.length,
    execution_intent_count: executionIntents.length,
    notes: [
      "allocator exposure currently starts from zero reserved state",
      "performance and heartbeat inputs are placeholder values in the first cycle integration"
    ],
    proposals,
    allocator_decisions: allocatorDecisions.map((entry) => entry.payload),
    risk_decisions: riskDecisions.map((entry) => entry.payload),
    execution_intents: executionIntents.map((entry) => entry.payload)
  });

  for (const proposal of proposals) {
    await persistLedgerEnvelope(
      context.decisionLedger,
      context.env,
      "strategy_proposal",
      proposal.proposal_id,
      cycleEnvelope.ts_utc,
      proposal
    );
  }

  for (const decision of allocatorDecisions) {
    await persistLedgerEnvelope(
      context.decisionLedger,
      context.env,
      "allocator_decision",
      decision.payload.decision_id,
      decision.ts_utc,
      decision.payload
    );
  }

  for (const decision of riskDecisions) {
    await persistLedgerEnvelope(
      context.decisionLedger,
      context.env,
      "risk_decision",
      decision.payload.decision_id,
      decision.ts_utc,
      decision.payload
    );
  }

  for (const intent of executionIntents) {
    await persistLedgerEnvelope(
      context.decisionLedger,
      context.env,
      "execution_intent",
      intent.payload.order_plan_id,
      intent.ts_utc,
      intent.payload
    );
  }

  await persistLedgerEnvelope(
    context.decisionLedger,
    context.env,
    "decision_cycle",
    cycleEnvelope.trace_id,
    cycleEnvelope.ts_utc,
    cycleEnvelope.payload
  );

  return cycleEnvelope;
}
