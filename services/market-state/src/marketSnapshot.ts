import type { EventEnvelope, UniverseMarketRecord } from "./contracts.js";

export interface MarketSnapshotPayload {
  market_id: string;
  contract_id: string;
  market_complex_id: string;
  status: "active" | "inactive";
  mid_price: number | null;
  best_bid: number | null;
  best_ask: number | null;
  spread_cents: number | null;
  top_bid_size: number | null;
  top_ask_size: number | null;
  time_to_resolution_hours: number | null;
  book_ts_utc: string;
}

export interface MarketDataHealth {
  observed_contracts: number;
  tracked_contracts: number;
  last_message_ts_utc: string | null;
  stale_threshold_ms: number;
  stale: boolean;
}

export interface ContractMarketState {
  market: UniverseMarketRecord;
  contractId: string;
  bestBid: number | null;
  bestAsk: number | null;
  topBidSize: number | null;
  topAskSize: number | null;
  lastTradePrice: number | null;
  bookTimestampMs: number | null;
}

function toMidPrice(bestBid: number | null, bestAsk: number | null): number | null {
  if (bestBid === null && bestAsk === null) {
    return null;
  }

  if (bestBid !== null && bestAsk !== null) {
    return Number(((bestBid + bestAsk) / 2).toFixed(6));
  }

  return bestBid ?? bestAsk;
}

function toResolutionHours(endDateUtc: string | null, nowMs: number): number | null {
  if (!endDateUtc) {
    return null;
  }

  const endMs = Date.parse(endDateUtc);
  if (Number.isNaN(endMs)) {
    return null;
  }

  return Number(((endMs - nowMs) / 3_600_000).toFixed(3));
}

export function toMarketSnapshotEnvelope(
  env: "sim" | "paper" | "prod",
  state: ContractMarketState
): EventEnvelope<MarketSnapshotPayload> {
  const tsMs = state.bookTimestampMs ?? Date.now();
  const spread =
    state.bestBid !== null && state.bestAsk !== null
      ? Number(((state.bestAsk - state.bestBid) * 100).toFixed(3))
      : null;

  return {
    schema_version: "v1",
    env,
    event_type: "market_snapshot",
    service: "market-state",
    trace_id: crypto.randomUUID(),
    ts_utc: new Date(tsMs).toISOString(),
    payload: {
      market_id: state.market.market_id,
      contract_id: state.contractId,
      market_complex_id: state.market.market_complex_id,
      status: state.market.active && state.market.accepting_orders ? "active" : "inactive",
      mid_price: toMidPrice(state.bestBid, state.bestAsk),
      best_bid: state.bestBid,
      best_ask: state.bestAsk,
      spread_cents: spread,
      top_bid_size: state.topBidSize,
      top_ask_size: state.topAskSize,
      time_to_resolution_hours: toResolutionHours(state.market.end_date_utc, tsMs),
      book_ts_utc: new Date(tsMs).toISOString()
    }
  };
}
