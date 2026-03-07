export interface EventEnvelope<T> {
  schema_version: "v1";
  env: "sim" | "paper" | "prod";
  event_type: string;
  service: "market-state";
  trace_id: string;
  ts_utc: string;
  payload: T;
}

export interface UniverseContract {
  contract_id: string;
  outcome: string;
  token_id: string | null;
  last_trade_price: number | null;
  best_bid: number | null;
  best_ask: number | null;
}

export interface UniverseMarketRecord {
  market_id: string;
  event_id: string | null;
  market_complex_id: string;
  slug: string;
  question: string;
  status: "active" | "inactive";
  active: boolean;
  accepting_orders: boolean;
  enable_order_book: boolean;
  approved: boolean;
  restricted: boolean;
  archived: boolean;
  closed: boolean;
  liquidity_usd: number | null;
  volume_24h_usd: number | null;
  volume_total_usd: number | null;
  spread_cents: number | null;
  order_price_min_tick_size: number | null;
  order_min_size: number | null;
  end_date_utc: string | null;
  tags: string[];
  contracts: UniverseContract[];
  ingest_source: "gamma-markets";
}

export interface UniverseSnapshotPayload {
  market_count: number;
  fetched_pages: number;
  gamma_base_url: string;
  markets: UniverseMarketRecord[];
}
