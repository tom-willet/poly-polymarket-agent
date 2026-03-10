import type { ControlConfig } from "./config.js";
import type { EventEnvelope, StrategyProposalPayload } from "./contracts.js";
import type { CurrentStateStore, MarketSnapshotPayload } from "./store.js";
import { loadOperatorState } from "./store.js";

interface ProposalContext {
  env: "sim" | "paper" | "prod";
  config: ControlConfig;
  currentState: CurrentStateStore;
}

interface BinaryPairCandidate {
  marketId: string;
  marketComplexId: string;
  question: string;
  slug: string;
  legs: [MarketSnapshotPayload, MarketSnapshotPayload];
}

type CandidateRejectionReason = "spread" | "resolution" | "edge";

interface CandidateEvaluationAccepted {
  status: "accepted";
  proposal: StrategyProposalPayload;
}

interface CandidateEvaluationRejected {
  status: "rejected";
  reason: CandidateRejectionReason;
  candidate: BinaryPairCandidate;
  detail: string;
}

type CandidateEvaluation = CandidateEvaluationAccepted | CandidateEvaluationRejected;

export interface CrossMarketConsistencyAnalysis {
  proposals: Array<EventEnvelope<StrategyProposalPayload>>;
  diagnostics: string[];
}

function round(value: number, decimals = 6): number {
  return Number(value.toFixed(decimals));
}

function proposalEnvelope(
  env: ProposalContext["env"],
  payload: StrategyProposalPayload
): EventEnvelope<StrategyProposalPayload> {
  return {
    schema_version: "v1",
    env,
    event_type: "strategy_proposal",
    service: "openclaw-control",
    trace_id: crypto.randomUUID(),
    ts_utc: new Date().toISOString(),
    payload
  };
}

function confidenceFromEdge(edgeAfterCosts: number, totalSpreadCents: number): number {
  const edgeCents = edgeAfterCosts * 100;
  const raw = 0.5 + Math.min(0.35, edgeCents / 20) - Math.min(0.15, totalSpreadCents / 40);
  return round(Math.max(0.5, Math.min(0.95, raw)), 3);
}

function buildInvalidators(candidate: BinaryPairCandidate, direction: "buy_both" | "sell_both"): string[] {
  const actionLabel = direction === "buy_both" ? "combined ask" : "combined bid";
  return [
    `${actionLabel} edge closes below threshold`,
    "either leg spread exceeds v1 proposal threshold",
    `market ${candidate.marketId} leaves active status`,
    "order-book depth degrades before allocation"
  ];
}

function totalCostsDecimal(config: ControlConfig, legCount: number): number {
  return (config.proposalCostPerLegCents * legCount) / 100;
}

function groupSnapshotsByMarket(markets: MarketSnapshotPayload[]): Map<string, MarketSnapshotPayload[]> {
  const byMarketId = new Map<string, MarketSnapshotPayload[]>();
  for (const market of markets) {
    byMarketId.set(market.market_id, [...(byMarketId.get(market.market_id) ?? []), market]);
  }
  return byMarketId;
}

function buildBinaryPairs(markets: MarketSnapshotPayload[]): {
  totalMarkets: number;
  skippedNonBinary: number;
  skippedInactive: number;
  candidates: BinaryPairCandidate[];
} {
  const byMarketId = groupSnapshotsByMarket(markets);
  const candidates: BinaryPairCandidate[] = [];
  let skippedNonBinary = 0;
  let skippedInactive = 0;

  for (const [marketId, snapshots] of byMarketId.entries()) {
    if (snapshots.length !== 2) {
      skippedNonBinary += 1;
      continue;
    }
    if (!snapshots.every((snapshot) => snapshot.status === "active")) {
      skippedInactive += 1;
      continue;
    }

    const [left, right] = snapshots;
    if (!left || !right) {
      continue;
    }

    candidates.push({
      marketId,
      marketComplexId: left.market_complex_id,
      question: left.question,
      slug: left.slug,
      legs: [left, right]
    });
  }

  return {
    totalMarkets: byMarketId.size,
    skippedNonBinary,
    skippedInactive,
    candidates
  };
}

function evaluateCandidate(candidate: BinaryPairCandidate, context: ProposalContext): CandidateEvaluation {
  const [left, right] = candidate.legs;
  const spreads = [left.spread_cents, right.spread_cents];
  if (spreads.some((spread) => spread === null || spread > context.config.proposalMaxSpreadCents)) {
    return {
      status: "rejected",
      reason: "spread",
      candidate,
      detail: `${candidate.question || candidate.marketId} spread above ${context.config.proposalMaxSpreadCents}c threshold`
    };
  }

  if (
    left.time_to_resolution_hours === null ||
    right.time_to_resolution_hours === null ||
    left.time_to_resolution_hours < 4 ||
    right.time_to_resolution_hours < 4
  ) {
    return {
      status: "rejected",
      reason: "resolution",
      candidate,
      detail: `${candidate.question || candidate.marketId} time to resolution below 4h minimum`
    };
  }

  const buyBothPrice = left.best_ask !== null && right.best_ask !== null ? left.best_ask + right.best_ask : null;
  const sellBothPrice = left.best_bid !== null && right.best_bid !== null ? left.best_bid + right.best_bid : null;
  const totalCosts = totalCostsDecimal(context.config, 2);

  const buyBothEdge = buyBothPrice === null ? Number.NEGATIVE_INFINITY : 1 - buyBothPrice - totalCosts;
  const sellBothEdge = sellBothPrice === null ? Number.NEGATIVE_INFINITY : sellBothPrice - 1 - totalCosts;

  const bestDirection = buyBothEdge >= sellBothEdge ? "buy_both" : "sell_both";
  const bestEdge = Math.max(buyBothEdge, sellBothEdge);
  const edgeCents = bestEdge * 100;
  if (edgeCents < context.config.proposalMinEdgeCents) {
    return {
      status: "rejected",
      reason: "edge",
      candidate,
      detail: `${candidate.question || candidate.marketId} best edge ${round(edgeCents, 3)}c below ${context.config.proposalMinEdgeCents}c threshold`
    };
  }

  const contracts =
    bestDirection === "buy_both"
      ? [
          { market_id: left.market_id, contract_id: left.contract_id, side: "buy" as const },
          { market_id: right.market_id, contract_id: right.contract_id, side: "buy" as const }
        ]
      : [
          { market_id: left.market_id, contract_id: left.contract_id, side: "sell" as const },
          { market_id: right.market_id, contract_id: right.contract_id, side: "sell" as const }
        ];

  const totalSpreadCents = (left.spread_cents ?? 0) + (right.spread_cents ?? 0);
  const combinedPrice = bestDirection === "buy_both" ? buyBothPrice : sellBothPrice;
  const holdingHours = Math.min(
    context.config.proposalDefaultHoldingHours,
    left.time_to_resolution_hours,
    right.time_to_resolution_hours
  );

  return {
    status: "accepted",
    proposal: {
      proposal_id: crypto.randomUUID(),
      sleeve_id: "cross_market_core",
      market_complex_id: candidate.marketComplexId,
      thesis:
        bestDirection === "buy_both"
          ? "Binary complement asks sum below par after modeled costs."
          : "Binary complement bids sum above par after modeled costs.",
      contracts,
      expected_edge_after_costs: round(bestEdge),
      confidence: confidenceFromEdge(bestEdge, totalSpreadCents),
      max_holding_hours: round(holdingHours, 3),
      invalidators: buildInvalidators(candidate, bestDirection),
      sizing_hint_usd: context.config.proposalSizingHintUsd,
      notes: `combined_${bestDirection === "buy_both" ? "ask" : "bid"}=${round(combinedPrice ?? 0, 4)} costs=${round(totalCosts, 4)}`
    }
  };
}

function diagnosticsFromEvaluations(
  grouped: ReturnType<typeof buildBinaryPairs>,
  evaluations: CandidateEvaluation[],
  operatorState: { paused: boolean; flatten_requested: boolean },
  marketDataStale: boolean
): string[] {
  const lines = [
    `tracked markets=${grouped.totalMarkets}`,
    `binary active candidates=${grouped.candidates.length}`,
    `skipped non-binary markets=${grouped.skippedNonBinary}`,
    `skipped inactive markets=${grouped.skippedInactive}`,
    `operator paused=${operatorState.paused}`,
    `operator flatten_requested=${operatorState.flatten_requested}`,
    `market data stale=${marketDataStale}`
  ];

  const rejectedCounts: Record<CandidateRejectionReason, number> = {
    spread: 0,
    resolution: 0,
    edge: 0
  };
  const rejectedExamples: string[] = [];

  for (const evaluation of evaluations) {
    if (evaluation.status !== "rejected") {
      continue;
    }
    rejectedCounts[evaluation.reason] += 1;
    if (rejectedExamples.length < 3) {
      rejectedExamples.push(evaluation.detail);
    }
  }

  lines.push(`accepted proposals=${evaluations.filter((evaluation) => evaluation.status === "accepted").length}`);
  lines.push(`rejected on spread=${rejectedCounts.spread}`);
  lines.push(`rejected on resolution=${rejectedCounts.resolution}`);
  lines.push(`rejected on edge=${rejectedCounts.edge}`);
  lines.push(...rejectedExamples);

  return lines;
}

export async function analyzeCrossMarketConsistency(
  context: ProposalContext
): Promise<CrossMarketConsistencyAnalysis> {
  const operatorState = await loadOperatorState(context.currentState, context.config.defaultMode);
  const health = await context.currentState.get<{ stale: boolean }>("health#market-data", "latest");
  const marketDataStale = !health || health.payload.stale;

  const markets = await context.currentState.queryByPkPrefix("market#");
  const snapshots = markets
    .filter((item) => item.sk === "snapshot")
    .map((item) => item.payload as MarketSnapshotPayload);

  const grouped = buildBinaryPairs(snapshots);

  if (operatorState.paused || operatorState.flatten_requested || marketDataStale) {
    return {
      proposals: [],
      diagnostics: diagnosticsFromEvaluations(grouped, [], operatorState, marketDataStale)
    };
  }

  const evaluations = grouped.candidates.map((candidate) => evaluateCandidate(candidate, context));
  const proposals = evaluations
    .filter((evaluation): evaluation is CandidateEvaluationAccepted => evaluation.status === "accepted")
    .map((evaluation) => proposalEnvelope(context.env, evaluation.proposal))
    .sort((left, right) => right.payload.expected_edge_after_costs - left.payload.expected_edge_after_costs);

  return {
    proposals,
    diagnostics: diagnosticsFromEvaluations(grouped, evaluations, operatorState, marketDataStale)
  };
}

export async function generateCrossMarketConsistencyProposals(
  context: ProposalContext
): Promise<Array<EventEnvelope<StrategyProposalPayload>>> {
  const analysis = await analyzeCrossMarketConsistency(context);
  return analysis.proposals;
}
