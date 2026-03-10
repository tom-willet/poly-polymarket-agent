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
  type ExposureState,
  type EventEnvelope as TradeCoreEnvelope,
  type ExecutionIntentPayload,
  type PerformanceState,
  type RiskDecisionPayload,
  type StrategyProposalPayload as TradeCoreProposalPayload
} from "@poly/trade-core";
import type { ControlConfig } from "./config.js";
import type { DecisionCyclePayload, EventEnvelope, StrategyProposalPayload } from "./contracts.js";
import { analyzeCrossMarketConsistency } from "./proposals.js";
import type {
  AccountSnapshotPayload,
  CurrentStateStore,
  DecisionLedgerStore,
  ExecutionHeartbeatPayload,
  PositionSnapshotPayload
} from "./store.js";
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
  const snapshots = accounts
    .filter((item) => item.sk === "snapshot")
    .sort((left, right) => right.ts_utc.localeCompare(left.ts_utc));
  if (snapshots.length === 0) {
    throw new Error("No account snapshot available for decision cycle");
  }

  const payload = snapshots[0]?.payload as AccountSnapshotPayload | undefined;
  if (!payload?.user_address) {
    throw new Error("Account snapshot is missing user_address");
  }

  return payload.user_address;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(2));
}

async function loadExposureState(
  currentState: CurrentStateStore,
  accountUserAddress: string
): Promise<{ exposure: ExposureState; notes: string[] }> {
  const notes: string[] = [];
  const positions = (await currentState.queryByPkPrefix("position#")).filter(
    (item) => item.sk === "snapshot"
  ) as Array<{ pk: string; sk: string; payload: PositionSnapshotPayload; ts_utc: string }>;

  if (positions.length > 0) {
    const exposure: ExposureState = {
      grossReservedUsd: 0,
      sleeveReservedUsd: {},
      marketComplexReservedUsd: {},
      contractReservedUsd: {}
    };

    for (const position of positions) {
      const gross = roundUsd(
        (position.payload.gross_exposure_usd ?? 0) + (position.payload.open_orders_reserved_usd ?? 0)
      );
      exposure.grossReservedUsd = roundUsd(exposure.grossReservedUsd + gross);
      exposure.sleeveReservedUsd[position.payload.sleeve_id] = roundUsd(
        (exposure.sleeveReservedUsd[position.payload.sleeve_id] ?? 0) + gross
      );
      exposure.marketComplexReservedUsd[position.payload.market_complex_id] = roundUsd(
        (exposure.marketComplexReservedUsd[position.payload.market_complex_id] ?? 0) + gross
      );
    }

    notes.push(`allocator exposure derived from ${positions.length} position_snapshot rows`);
    return { exposure, notes };
  }

  const accountSnapshot = await currentState.get<AccountSnapshotPayload>(`account#${accountUserAddress}`, "snapshot");
  const grossReservedUsd = roundUsd(accountSnapshot?.payload.total_position_value_usd ?? 0);
  notes.push("allocator exposure fell back to account_state_snapshot total_position_value_usd");
  return {
    exposure: {
      grossReservedUsd,
      sleeveReservedUsd: {},
      marketComplexReservedUsd: {},
      contractReservedUsd: {}
    },
    notes
  };
}

async function loadPerformanceState(
  currentState: CurrentStateStore,
  bankrollUsd: number
): Promise<{ performance: PerformanceState; notes: string[] }> {
  const notes: string[] = [];
  const positions = (await currentState.queryByPkPrefix("position#")).filter(
    (item) => item.sk === "snapshot"
  ) as Array<{ pk: string; sk: string; payload: PositionSnapshotPayload; ts_utc: string }>;

  if (positions.length > 0) {
    const pnlUsd = positions.reduce(
      (sum, position) => sum + (position.payload.realized_pnl_usd ?? 0) + (position.payload.unrealized_pnl_usd ?? 0),
      0
    );
    const lossRatio = Math.max(0, -pnlUsd / bankrollUsd);
    notes.push(`performance derived from ${positions.length} position_snapshot rows`);
    return {
      performance: {
        dailyLossRatio: lossRatio,
        weeklyDrawdownRatio: lossRatio
      },
      notes
    };
  }

  notes.push("performance fell back to zero because no position_snapshot rows are available");
  return {
    performance: {
      dailyLossRatio: 0,
      weeklyDrawdownRatio: 0
    },
    notes
  };
}

async function loadExecutionHeartbeatHealthy(
  currentState: CurrentStateStore,
  env: DecisionCycleContext["env"]
): Promise<{ heartbeat: ExecutionHeartbeatPayload; notes: string[] }> {
  const notes: string[] = [];
  const heartbeat = await currentState.get<ExecutionHeartbeatPayload>("health#execution-heartbeat", "latest");
  if (heartbeat) {
    notes.push("execution heartbeat derived from current-state health row");
    return {
      heartbeat: heartbeat.payload,
      notes
    };
  }

  const healthy = env !== "prod";
  notes.push(
    healthy
      ? "execution heartbeat defaulted healthy in non-prod because no heartbeat row exists"
      : "execution heartbeat defaulted unhealthy because no heartbeat row exists in prod"
  );
  return {
    heartbeat: {
      active: false,
      healthy,
      last_sent_ts_utc: null,
      last_ack_ts_utc: null,
      heartbeat_id: null,
      timeout_ms: 0
    },
    notes
  };
}

async function persistCurrentStateEnvelope<T>(
  currentState: CurrentStateStore,
  env: DecisionCycleContext["env"],
  eventType: string,
  entityId: string,
  payload: T,
  tsUtc = new Date().toISOString()
): Promise<void> {
  await currentState.put(`${eventType}#${entityId}`, "latest", {
    schema_version: "v1",
    env,
    event_type: eventType,
    service: "openclaw-control",
    trace_id: crypto.randomUUID(),
    ts_utc: tsUtc,
    payload
  });
}

export async function runDecisionCycle(
  context: DecisionCycleContext
): Promise<EventEnvelope<DecisionCyclePayload>> {
  const operatorState = await loadOperatorState(context.currentState, context.config.defaultMode);
  const executionConfig = loadExecutionConfig();
  const heartbeatState = await loadExecutionHeartbeatHealthy(context.currentState, context.env);
  const resolvedHeartbeat: ExecutionHeartbeatPayload = {
    ...heartbeatState.heartbeat,
    timeout_ms:
      heartbeatState.heartbeat.timeout_ms > 0
        ? heartbeatState.heartbeat.timeout_ms
        : executionConfig.heartbeatTimeoutMs
  };
  const proposalAnalysis = await analyzeCrossMarketConsistency({
    env: context.env,
    config: context.config,
    currentState: context.currentState
  });
  const proposalEnvelopes = proposalAnalysis.proposals;
  const proposals = proposalEnvelopes.map((entry) => entry.payload);

  if (proposals.length === 0) {
    const cycleEnvelope = envelope(context.env, {
      proposal_count: 0,
      allocator_decision_count: 0,
      risk_decision_count: 0,
      execution_intent_count: 0,
      notes: [
        "no eligible cross-market consistency proposals found",
        ...proposalAnalysis.diagnostics,
        ...heartbeatState.notes
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
  const accountUserAddress = await selectAccountUserAddress(context.currentState);
  const exposureState = await loadExposureState(context.currentState, accountUserAddress);
  const allocatorDecisions = allocateProposals(
    proposals.map((proposal) => toTradeCoreProposal(proposal)),
    {
      config: allocatorConfig,
      exposure: exposureState.exposure
    }
  );

  const riskConfig = loadRiskConfig();
  const performanceState = await loadPerformanceState(context.currentState, allocatorConfig.bankrollUsd);
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
      performance: performanceState.performance,
      estimatedTotalCostsUsd: 0,
      executionHeartbeatHealthy: resolvedHeartbeat.healthy
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
    notes: [...proposalAnalysis.diagnostics, ...exposureState.notes, ...performanceState.notes, ...heartbeatState.notes],
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
    await persistCurrentStateEnvelope(
      context.currentState,
      context.env,
      "execution_intent",
      intent.payload.order_plan_id,
      intent.payload,
      intent.ts_utc
    );
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
