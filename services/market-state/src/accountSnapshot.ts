import type {
  AccountBalanceRecord,
  AccountOpenOrderRecord,
  AccountPositionRecord,
  AccountTradeRecord,
  EventEnvelope,
  PositionSnapshotPayload
} from "./contracts.js";

export interface AccountStateSnapshotPayload {
  user_address: string;
  funder_address: string;
  collateral: AccountBalanceRecord;
  open_order_count: number;
  position_count: number;
  recent_trade_count: number;
  total_position_value_usd: number | null;
  open_orders: AccountOpenOrderRecord[];
  positions: AccountPositionRecord[];
  recent_trades: AccountTradeRecord[];
}

export interface AccountStateHealthPayload {
  last_success_ts_utc: string | null;
  stale_threshold_ms: number;
  stale: boolean;
  reconciliation_ok: boolean;
  issues: string[];
  open_order_count: number;
  position_count: number;
  recent_trade_count: number;
}

function envelope<T>(
  env: "sim" | "paper" | "prod",
  eventType: "account_state_snapshot" | "account_state_health" | "position_snapshot",
  payload: T,
  tsMs: number
): EventEnvelope<T> {
  return {
    schema_version: "v1",
    env,
    event_type: eventType,
    service: "market-state",
    trace_id: crypto.randomUUID(),
    ts_utc: new Date(tsMs).toISOString(),
    payload
  };
}

export function toAccountStateSnapshotEnvelope(
  env: "sim" | "paper" | "prod",
  payload: AccountStateSnapshotPayload,
  tsMs: number
): EventEnvelope<AccountStateSnapshotPayload> {
  return envelope(env, "account_state_snapshot", payload, tsMs);
}

export function toAccountStateHealthEnvelope(
  env: "sim" | "paper" | "prod",
  payload: AccountStateHealthPayload,
  tsMs: number
): EventEnvelope<AccountStateHealthPayload> {
  return envelope(env, "account_state_health", payload, tsMs);
}

export function toPositionSnapshotEnvelope(
  env: "sim" | "paper" | "prod",
  payload: PositionSnapshotPayload,
  tsMs: number
): EventEnvelope<PositionSnapshotPayload> {
  return envelope(env, "position_snapshot", payload, tsMs);
}

function roundUsd(value: number | null): number {
  return Number((value ?? 0).toFixed(2));
}

function inferredMarketComplexId(position: AccountPositionRecord): string {
  if (position.event_slug) {
    return `event:${position.event_slug}`;
  }
  if (position.market_id) {
    return `market:${position.market_id}`;
  }
  return `contract:${position.contract_id}`;
}

function inferredUnrealizedPnl(position: AccountPositionRecord): number {
  if (
    position.current_value_usd !== null &&
    position.avg_price !== null &&
    position.size !== null
  ) {
    return roundUsd(position.current_value_usd - position.avg_price * position.size);
  }

  return 0;
}

export function toPositionSnapshotEnvelopes(
  env: "sim" | "paper" | "prod",
  accountSnapshot: AccountStateSnapshotPayload,
  tsMs: number
): EventEnvelope<PositionSnapshotPayload>[] {
  return accountSnapshot.positions.map((position) =>
    toPositionSnapshotEnvelope(
      env,
      {
        wallet_id: accountSnapshot.funder_address,
        sleeve_id: "cross_market_core",
        market_complex_id: inferredMarketComplexId(position),
        gross_exposure_usd: roundUsd(position.current_value_usd),
        net_exposure_usd: roundUsd(position.current_value_usd),
        realized_pnl_usd: roundUsd(position.cash_pnl_usd),
        unrealized_pnl_usd: inferredUnrealizedPnl(position),
        open_orders_reserved_usd: 0,
        snapshot_ts_utc: new Date(tsMs).toISOString()
      },
      tsMs
    )
  );
}
