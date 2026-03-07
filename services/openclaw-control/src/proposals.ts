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
  legs: [MarketSnapshotPayload, MarketSnapshotPayload];
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

function binaryPairs(markets: MarketSnapshotPayload[]): BinaryPairCandidate[] {
  const byMarketId = new Map<string, MarketSnapshotPayload[]>();
  for (const market of markets) {
    byMarketId.set(market.market_id, [...(byMarketId.get(market.market_id) ?? []), market]);
  }

  const pairs: BinaryPairCandidate[] = [];
  for (const [marketId, snapshots] of byMarketId.entries()) {
    if (snapshots.length !== 2) {
      continue;
    }
    if (!snapshots.every((snapshot) => snapshot.status === "active")) {
      continue;
    }
    const [left, right] = snapshots;
    if (!left || !right) {
      continue;
    }
    pairs.push({
      marketId,
      marketComplexId: left.market_complex_id,
      legs: [left, right]
    });
  }

  return pairs;
}

function proposalForCandidate(
  candidate: BinaryPairCandidate,
  context: ProposalContext
): StrategyProposalPayload | null {
  const [left, right] = candidate.legs;
  if (!left || !right) {
    return null;
  }

  const spreads = [left.spread_cents, right.spread_cents];
  if (spreads.some((spread) => spread === null || spread > context.config.proposalMaxSpreadCents)) {
    return null;
  }

  if (
    left.time_to_resolution_hours === null ||
    right.time_to_resolution_hours === null ||
    left.time_to_resolution_hours < 4 ||
    right.time_to_resolution_hours < 4
  ) {
    return null;
  }

  const buyBothPrice = left.best_ask !== null && right.best_ask !== null ? left.best_ask + right.best_ask : null;
  const sellBothPrice = left.best_bid !== null && right.best_bid !== null ? left.best_bid + right.best_bid : null;
  const totalCosts = totalCostsDecimal(context.config, 2);

  const buyBothEdge = buyBothPrice === null ? Number.NEGATIVE_INFINITY : 1 - buyBothPrice - totalCosts;
  const sellBothEdge = sellBothPrice === null ? Number.NEGATIVE_INFINITY : sellBothPrice - 1 - totalCosts;

  const bestDirection = buyBothEdge >= sellBothEdge ? "buy_both" : "sell_both";
  const bestEdge = Math.max(buyBothEdge, sellBothEdge);
  if (bestEdge * 100 < context.config.proposalMinEdgeCents) {
    return null;
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
  };
}

export async function generateCrossMarketConsistencyProposals(
  context: ProposalContext
): Promise<Array<EventEnvelope<StrategyProposalPayload>>> {
  const operatorState = await loadOperatorState(context.currentState, context.config.defaultMode);
  if (operatorState.paused || operatorState.flatten_requested) {
    return [];
  }

  const health = await context.currentState.get<{ stale: boolean }>("health#market-data", "latest");
  if (!health || health.payload.stale) {
    return [];
  }

  const markets = await context.currentState.queryByPkPrefix("market#");
  const snapshots = markets
    .filter((item) => item.sk === "snapshot")
    .map((item) => item.payload as MarketSnapshotPayload);

  return binaryPairs(snapshots)
    .map((candidate) => proposalForCandidate(candidate, context))
    .filter((proposal): proposal is StrategyProposalPayload => proposal !== null)
    .sort((left, right) => right.expected_edge_after_costs - left.expected_edge_after_costs)
    .map((proposal) => proposalEnvelope(context.env, proposal));
}
