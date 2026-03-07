import type { AppConfig } from "../config.js";
import type { EventEnvelope, UniverseSnapshotPayload } from "../contracts.js";
import type { GammaMarket } from "./gammaTypes.js";
import { normalizeGammaMarket } from "./normalize.js";

export interface MarketUniverseResult {
  fetchedPages: number;
  markets: GammaMarket[];
}

export class GammaMarketClient {
  constructor(private readonly config: AppConfig) {}

  async fetchActiveMarketUniverse(): Promise<MarketUniverseResult> {
    const markets: GammaMarket[] = [];
    let fetchedPages = 0;

    for (let page = 0; page < this.config.gammaMaxPages; page += 1) {
      const offset = page * this.config.gammaPageSize;
      const pageMarkets = await this.fetchMarketPage(offset);

      if (pageMarkets.length === 0) {
        break;
      }

      markets.push(...pageMarkets);
      fetchedPages += 1;

      if (pageMarkets.length < this.config.gammaPageSize) {
        break;
      }
    }

    return { fetchedPages, markets };
  }

  async buildSnapshotEnvelope(): Promise<EventEnvelope<UniverseSnapshotPayload>> {
    const result = await this.fetchActiveMarketUniverse();
    const normalizedMarkets = result.markets
      .filter((market) => market.active && !market.closed && !market.archived)
      .filter((market) => this.config.includeRestricted || !market.restricted)
      .map(normalizeGammaMarket);

    return {
      schema_version: "v1",
      env: this.config.env,
      event_type: "market_universe_snapshot",
      service: "market-state",
      trace_id: crypto.randomUUID(),
      ts_utc: new Date().toISOString(),
      payload: {
        market_count: normalizedMarkets.length,
        fetched_pages: result.fetchedPages,
        gamma_base_url: this.config.gammaBaseUrl,
        markets: normalizedMarkets
      }
    };
  }

  private async fetchMarketPage(offset: number): Promise<GammaMarket[]> {
    const url = new URL("/markets", this.config.gammaBaseUrl);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("archived", "false");
    url.searchParams.set("limit", String(this.config.gammaPageSize));
    url.searchParams.set("offset", String(offset));

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Gamma request failed with status ${response.status}`);
    }

    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) {
      throw new Error("Gamma response was not an array");
    }

    return body as GammaMarket[];
  }
}
