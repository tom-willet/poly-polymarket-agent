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

export interface AccountBalanceRecord {
  asset_type: "COLLATERAL";
  token_id: null;
  balance: number | null;
  allowance: number | null;
}

export interface AccountOpenOrderRecord {
  order_id: string;
  market_id: string;
  contract_id: string;
  side: string;
  status: string;
  price: number | null;
  original_size: number | null;
  matched_size: number | null;
  remaining_size: number | null;
  outcome: string | null;
  created_at_utc: string | null;
  expiration_utc: string | null;
}

export interface AccountTradeRecord {
  trade_id: string;
  market_id: string;
  contract_id: string;
  side: string;
  price: number | null;
  size: number | null;
  status: string;
  outcome: string | null;
  match_time_utc: string | null;
  last_update_utc: string | null;
  trader_side: "TAKER" | "MAKER" | null;
  transaction_hash: string | null;
}

export interface AccountPositionRecord {
  market_id: string | null;
  contract_id: string;
  condition_id: string | null;
  outcome: string | null;
  size: number | null;
  avg_price: number | null;
  current_price: number | null;
  current_value_usd: number | null;
  cash_pnl_usd: number | null;
  redeemable: boolean;
  title: string | null;
  slug: string | null;
  event_slug: string | null;
  end_date_utc: string | null;
}

export interface PositionSnapshotPayload {
  wallet_id: string;
  sleeve_id: string;
  market_complex_id: string;
  gross_exposure_usd: number;
  net_exposure_usd: number;
  realized_pnl_usd: number;
  unrealized_pnl_usd: number;
  open_orders_reserved_usd: number;
  snapshot_ts_utc: string;
}
