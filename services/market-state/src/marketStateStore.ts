import type { UniverseMarketRecord } from "./contracts.js";
import {
  toMarketSnapshotEnvelope,
  type ContractMarketState,
  type MarketDataHealth
} from "./marketSnapshot.js";
import type {
  MarketBestBidAskEvent,
  MarketBookEvent,
  MarketLastTradePriceEvent,
  MarketPriceChangeEvent
} from "./polymarket/marketChannelTypes.js";

function parseNumber(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class MarketStateStore {
  private readonly byAssetId = new Map<string, ContractMarketState>();
  private latestMessageTimestampMs: number | null = null;

  constructor(
    private readonly env: "sim" | "paper" | "prod",
    markets: UniverseMarketRecord[],
    trackedAssetIds?: string[]
  ) {
    const trackedAssetIdSet = trackedAssetIds ? new Set(trackedAssetIds) : null;

    for (const market of markets) {
      for (const contract of market.contracts) {
        const tokenId = contract.token_id ?? contract.contract_id;
        if (trackedAssetIdSet && !trackedAssetIdSet.has(tokenId)) {
          continue;
        }

        this.byAssetId.set(tokenId, {
          market,
          contractId: contract.contract_id,
          bestBid: contract.best_bid,
          bestAsk: contract.best_ask,
          topBidSize: null,
          topAskSize: null,
          lastTradePrice: contract.last_trade_price,
          bookTimestampMs: null
        });
      }
    }
  }

  assetIds(): string[] {
    return [...this.byAssetId.keys()];
  }

  handleBook(event: MarketBookEvent) {
    const state = this.byAssetId.get(event.asset_id);
    if (!state) {
      return null;
    }

    this.latestMessageTimestampMs = Number.parseInt(event.timestamp, 10);
    state.bestBid = parseNumber(event.bids[0]?.price ?? "");
    state.bestAsk = parseNumber(event.asks[0]?.price ?? "");
    state.topBidSize = parseNumber(event.bids[0]?.size ?? "");
    state.topAskSize = parseNumber(event.asks[0]?.size ?? "");
    state.bookTimestampMs = this.latestMessageTimestampMs;

    return toMarketSnapshotEnvelope(this.env, state);
  }

  handleBestBidAsk(event: MarketBestBidAskEvent) {
    const state = this.byAssetId.get(event.asset_id);
    if (!state) {
      return null;
    }

    this.latestMessageTimestampMs = Number.parseInt(event.timestamp, 10);
    state.bestBid = parseNumber(event.best_bid);
    state.bestAsk = parseNumber(event.best_ask);
    state.bookTimestampMs = this.latestMessageTimestampMs;

    return toMarketSnapshotEnvelope(this.env, state);
  }

  handleLastTradePrice(event: MarketLastTradePriceEvent) {
    const state = this.byAssetId.get(event.asset_id);
    if (!state) {
      return null;
    }

    this.latestMessageTimestampMs = Number.parseInt(event.timestamp, 10);
    state.lastTradePrice = parseNumber(event.price);
    state.bookTimestampMs = this.latestMessageTimestampMs;

    return toMarketSnapshotEnvelope(this.env, state);
  }

  handlePriceChange(event: MarketPriceChangeEvent) {
    this.latestMessageTimestampMs = Number.parseInt(event.timestamp, 10);
    const envelopes = [];

    for (const change of event.price_changes) {
      const state = this.byAssetId.get(change.asset_id);
      if (!state) {
        continue;
      }

      state.lastTradePrice = parseNumber(change.price);
      state.bestBid = parseNumber(change.best_bid);
      state.bestAsk = parseNumber(change.best_ask);
      state.bookTimestampMs = this.latestMessageTimestampMs;
      envelopes.push(toMarketSnapshotEnvelope(this.env, state));
    }

    return envelopes;
  }

  health(nowMs: number, staleThresholdMs: number): MarketDataHealth {
    const observedContracts = [...this.byAssetId.values()].filter((state) => state.bookTimestampMs !== null).length;

    return {
      observed_contracts: observedContracts,
      tracked_contracts: this.byAssetId.size,
      last_message_ts_utc:
        this.latestMessageTimestampMs === null ? null : new Date(this.latestMessageTimestampMs).toISOString(),
      stale_threshold_ms: staleThresholdMs,
      stale:
        this.latestMessageTimestampMs === null ? true : nowMs - this.latestMessageTimestampMs > staleThresholdMs
    };
  }
}
