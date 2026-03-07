import WebSocket, { type RawData } from "ws";
import type { EventEnvelope, UniverseMarketRecord } from "../contracts.js";
import { MarketStateStore } from "../marketStateStore.js";
import type { MarketDataHealth, MarketSnapshotPayload } from "../marketSnapshot.js";
import type { AppConfig } from "../config.js";
import type { MarketChannelEvent } from "./marketChannelTypes.js";

const HEARTBEAT_MS = 10_000;

export interface StreamOptions {
  assetLimit: number;
  durationSeconds: number;
  onSnapshot: (snapshot: EventEnvelope<MarketSnapshotPayload>) => void;
  onHealth?: (health: EventEnvelope<MarketDataHealth>) => void;
}

export class MarketChannelClient {
  constructor(private readonly config: AppConfig) {}

  async streamMarkets(markets: UniverseMarketRecord[], options: StreamOptions): Promise<void> {
    const assetIds = markets
      .flatMap((market) => market.contracts)
      .map((contract) => contract.token_id ?? contract.contract_id)
      .slice(0, options.assetLimit);
    if (assetIds.length === 0) {
      throw new Error("No asset IDs available for WebSocket subscription");
    }
    const store = new MarketStateStore(this.config.env, markets, assetIds);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.config.marketWsUrl);
      let heartbeat: NodeJS.Timeout | undefined;
      let durationTimer: NodeJS.Timeout | undefined;
      let settled = false;

      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        callback();
      };

      const cleanup = () => {
        if (heartbeat) {
          clearInterval(heartbeat);
        }
        if (durationTimer) {
          clearTimeout(durationTimer);
        }
      };

      ws.on("open", () => {
        ws.send(
          JSON.stringify({
            assets_ids: assetIds,
            type: "market",
            custom_feature_enabled: true
          })
        );

        heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send("PING");
          }
        }, HEARTBEAT_MS);

        durationTimer = setTimeout(() => {
          ws.close();
        }, options.durationSeconds * 1000);
      });

      ws.on("message", (raw: RawData) => {
        const text = raw.toString();
        if (text === "PONG") {
          return;
        }

        const payload = JSON.parse(text) as MarketChannelEvent | MarketChannelEvent[];
        const events = Array.isArray(payload) ? payload : [payload];

        for (const event of events) {
          if (!("event_type" in event)) {
            continue;
          }

          if (event.event_type === "book") {
            const snapshot = store.handleBook(event);
            if (snapshot) {
              options.onSnapshot(snapshot);
            }
          } else if (event.event_type === "best_bid_ask") {
            const snapshot = store.handleBestBidAsk(event);
            if (snapshot) {
              options.onSnapshot(snapshot);
            }
          } else if (event.event_type === "last_trade_price") {
            const snapshot = store.handleLastTradePrice(event);
            if (snapshot) {
              options.onSnapshot(snapshot);
            }
          } else if (event.event_type === "price_change") {
            for (const snapshot of store.handlePriceChange(event)) {
              options.onSnapshot(snapshot);
            }
          }
        }
      });

      ws.on("error", (error: Error) => {
        settle(() => reject(error));
      });

      ws.on("close", () => {
        if (options.onHealth) {
          options.onHealth({
            schema_version: "v1",
            env: this.config.env,
            event_type: "market_data_health",
            service: "market-state",
            trace_id: crypto.randomUUID(),
            ts_utc: new Date().toISOString(),
            payload: store.health(Date.now(), this.config.marketDataStaleAfterMs)
          });
        }

        settle(resolve);
      });
    });
  }
}
