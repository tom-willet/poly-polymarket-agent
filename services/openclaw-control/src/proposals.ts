import type { ControlConfig } from "./config.js";
import type { EventEnvelope, StrategyProposalPayload } from "./contracts.js";
import type { CurrentStateStore, MarketSnapshotPayload } from "./store.js";
import { loadOperatorState } from "./store.js";

interface ProposalContext {
  env: "sim" | "paper" | "prod";
  config: ControlConfig;
  currentState: CurrentStateStore;
}

interface EventBasketCandidate {
  marketComplexId: string;
  marketCount: number;
  label: string;
  legs: MarketSnapshotPayload[];
}

type CandidateRejectionReason = "spread" | "resolution" | "edge";

interface CandidateEvaluationAccepted {
  status: "accepted";
  proposal: StrategyProposalPayload;
}

interface CandidateEvaluationRejected {
  status: "rejected";
  reason: CandidateRejectionReason;
  candidate: EventBasketCandidate;
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

function buildInvalidators(
  candidate: EventBasketCandidate,
  direction: "buy_all_yes" | "sell_all_yes"
): string[] {
  const actionLabel = direction === "buy_all_yes" ? "combined YES ask basket" : "combined YES bid basket";
  return [
    `${actionLabel} edge closes below threshold`,
    "any basket leg spread exceeds v1 proposal threshold",
    `event basket ${candidate.marketComplexId} leaves active status`,
    "basket composition changes or quoted outcomes stop covering the same event complex",
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

function basketLabel(marketComplexId: string, legs: MarketSnapshotPayload[]): string {
  const sample = legs[0];
  if (!sample) {
    return marketComplexId;
  }

  return sample.event_id ? `event ${sample.event_id}` : sample.slug || sample.question || marketComplexId;
}

function buildEventBaskets(markets: MarketSnapshotPayload[]): {
  totalMarkets: number;
  skippedNonBinary: number;
  skippedInactive: number;
  binaryActiveMarkets: number;
  skippedSingleMarketComplexes: number;
  candidates: EventBasketCandidate[];
} {
  const byMarketId = groupSnapshotsByMarket(markets);
  const byMarketComplexId = new Map<string, MarketSnapshotPayload[]>();
  let skippedNonBinary = 0;
  let skippedInactive = 0;
  let binaryActiveMarkets = 0;

  for (const snapshots of byMarketId.values()) {
    if (snapshots.length !== 2) {
      skippedNonBinary += 1;
      continue;
    }
    if (!snapshots.every((snapshot) => snapshot.status === "active")) {
      skippedInactive += 1;
      continue;
    }

    const yesSnapshot = snapshots.find((snapshot) => snapshot.outcome.toLowerCase() === "yes");
    const noSnapshot = snapshots.find((snapshot) => snapshot.outcome.toLowerCase() === "no");
    if (!yesSnapshot || !noSnapshot) {
      skippedNonBinary += 1;
      continue;
    }

    binaryActiveMarkets += 1;
    byMarketComplexId.set(yesSnapshot.market_complex_id, [
      ...(byMarketComplexId.get(yesSnapshot.market_complex_id) ?? []),
      yesSnapshot
    ]);
  }

  const candidates: EventBasketCandidate[] = [];
  let skippedSingleMarketComplexes = 0;
  for (const [marketComplexId, legs] of byMarketComplexId.entries()) {
    if (legs.length < 2) {
      skippedSingleMarketComplexes += 1;
      continue;
    }

    candidates.push({
      marketComplexId,
      marketCount: legs.length,
      label: basketLabel(marketComplexId, legs),
      legs: [...legs].sort((left, right) => left.market_id.localeCompare(right.market_id))
    });
  }

  return {
    totalMarkets: byMarketId.size,
    skippedNonBinary,
    skippedInactive,
    binaryActiveMarkets,
    skippedSingleMarketComplexes,
    candidates
  };
}

function evaluateCandidate(candidate: EventBasketCandidate, context: ProposalContext): CandidateEvaluation {
  const spreads = candidate.legs.map((leg) => leg.spread_cents);
  if (spreads.some((spread) => spread === null || spread > context.config.proposalMaxSpreadCents)) {
    return {
      status: "rejected",
      reason: "spread",
      candidate,
      detail: `${candidate.label} basket spread above ${context.config.proposalMaxSpreadCents}c threshold`
    };
  }

  if (
    candidate.legs.some(
      (leg) => leg.time_to_resolution_hours === null || leg.time_to_resolution_hours < 4
    )
  ) {
    return {
      status: "rejected",
      reason: "resolution",
      candidate,
      detail: `${candidate.label} has at least one leg below the 4h resolution minimum`
    };
  }

  const buyAllYesPrice = candidate.legs.every((leg) => leg.best_ask !== null)
    ? candidate.legs.reduce((sum, leg) => sum + (leg.best_ask ?? 0), 0)
    : null;
  const sellAllYesPrice = candidate.legs.every((leg) => leg.best_bid !== null)
    ? candidate.legs.reduce((sum, leg) => sum + (leg.best_bid ?? 0), 0)
    : null;
  const totalCosts = totalCostsDecimal(context.config, candidate.legs.length);

  const buyAllYesEdge =
    buyAllYesPrice === null ? Number.NEGATIVE_INFINITY : 1 - buyAllYesPrice - totalCosts;
  const sellAllYesEdge =
    sellAllYesPrice === null ? Number.NEGATIVE_INFINITY : sellAllYesPrice - 1 - totalCosts;

  const bestDirection = buyAllYesEdge >= sellAllYesEdge ? "buy_all_yes" : "sell_all_yes";
  const bestEdge = Math.max(buyAllYesEdge, sellAllYesEdge);
  const edgeCents = bestEdge * 100;
  if (edgeCents < context.config.proposalMinEdgeCents) {
    return {
      status: "rejected",
      reason: "edge",
      candidate,
      detail: `${candidate.label} best event-basket edge ${round(edgeCents, 3)}c below ${context.config.proposalMinEdgeCents}c threshold`
    };
  }

  const contracts = candidate.legs.map((leg) => ({
    market_id: leg.market_id,
    contract_id: leg.contract_id,
    side: bestDirection === "buy_all_yes" ? ("buy" as const) : ("sell" as const)
  }));

  const totalSpreadCents = candidate.legs.reduce((sum, leg) => sum + (leg.spread_cents ?? 0), 0);
  const combinedPrice = bestDirection === "buy_all_yes" ? buyAllYesPrice : sellAllYesPrice;
  const holdingHours = Math.min(
    context.config.proposalDefaultHoldingHours,
    ...candidate.legs.map((leg) => leg.time_to_resolution_hours ?? context.config.proposalDefaultHoldingHours)
  );

  return {
    status: "accepted",
    proposal: {
      proposal_id: crypto.randomUUID(),
      sleeve_id: "cross_market_core",
      market_complex_id: candidate.marketComplexId,
      thesis:
        bestDirection === "buy_all_yes"
          ? "Mutually exclusive YES asks across related markets sum below par after modeled costs."
          : "Mutually exclusive YES bids across related markets sum above par after modeled costs.",
      contracts,
      expected_edge_after_costs: round(bestEdge),
      confidence: confidenceFromEdge(bestEdge, totalSpreadCents),
      max_holding_hours: round(holdingHours, 3),
      invalidators: buildInvalidators(candidate, bestDirection),
      sizing_hint_usd: context.config.proposalSizingHintUsd,
      notes: `event_legs=${candidate.marketCount} combined_yes_${bestDirection === "buy_all_yes" ? "ask" : "bid"}=${round(combinedPrice ?? 0, 4)} costs=${round(totalCosts, 4)}`
    }
  };
}

function diagnosticsFromEvaluations(
  grouped: ReturnType<typeof buildEventBaskets>,
  evaluations: CandidateEvaluation[],
  operatorState: { paused: boolean; flatten_requested: boolean },
  marketDataStale: boolean
): string[] {
  const lines = [
    `tracked markets=${grouped.totalMarkets}`,
    `binary active markets=${grouped.binaryActiveMarkets}`,
    `candidate event baskets=${grouped.candidates.length}`,
    `skipped non-binary markets=${grouped.skippedNonBinary}`,
    `skipped inactive markets=${grouped.skippedInactive}`,
    `skipped single-market complexes=${grouped.skippedSingleMarketComplexes}`,
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

  const grouped = buildEventBaskets(snapshots);

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
