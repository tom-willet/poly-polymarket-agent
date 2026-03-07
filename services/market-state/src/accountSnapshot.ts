import type {
  AccountBalanceRecord,
  AccountOpenOrderRecord,
  AccountPositionRecord,
  AccountTradeRecord,
  EventEnvelope
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
  eventType: "account_state_snapshot" | "account_state_health",
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
