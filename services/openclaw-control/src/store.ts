import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { OperatorStatePayload } from "./contracts.js";

export interface StoredEnvelope<T> {
  payload: T;
  ts_utc: string;
  event_type: string;
}

export interface MarketHealthPayload {
  stale: boolean;
  tracked_contracts: number;
  observed_contracts: number;
  last_message_ts_utc: string;
}

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

export interface AccountHealthPayload {
  stale: boolean;
  reconciliation_ok: boolean;
  open_order_count: number;
  position_count: number;
  recent_trade_count: number;
}

export interface AccountSnapshotPayload {
  user_address: string;
  funder_address: string;
  collateral: {
    balance: number;
    allowance: number;
  };
  open_order_count: number;
  position_count: number;
  recent_trade_count: number;
  total_position_value_usd: number;
  open_orders?: Array<{
    order_id: string;
    market_id: string;
    contract_id: string;
    side: string;
    status: string;
    price: number | null;
    original_size: number | null;
    matched_size: number | null;
    remaining_size: number | null;
    outcome?: string | null;
    created_at_utc?: string | null;
    expiration_utc?: string | null;
  }>;
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

export interface PaperCashSnapshotPayload {
  wallet_id: string;
  starting_cash_usd: number;
  cash_balance_usd: number;
  reserved_cash_usd: number;
  available_cash_usd: number;
  realized_pnl_usd: number;
  updated_at_utc: string;
}

export interface ExecutionHeartbeatPayload {
  active: boolean;
  healthy: boolean;
  last_sent_ts_utc: string | null;
  last_ack_ts_utc: string | null;
  heartbeat_id: string | null;
  timeout_ms: number;
}

export interface CurrentStateStore {
  get<T>(pk: string, sk: string): Promise<StoredEnvelope<T> | null>;
  queryByPkPrefix(prefix: string): Promise<Array<{ pk: string; sk: string; payload: unknown; ts_utc: string }>>;
  put(pk: string, sk: string, item: Record<string, unknown>): Promise<void>;
}

export interface DecisionLedgerStore {
  put(pk: string, sk: string, item: Record<string, unknown>): Promise<void>;
  query(pk: string, limit?: number): Promise<Array<{ pk: string; sk: string; payload: unknown; ts_utc: string; event_type: string }>>;
}

export class DynamoDbCurrentStateStore implements CurrentStateStore {
  private readonly client: DynamoDBDocumentClient;

  constructor(private readonly tableName: string) {
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async get<T>(pk: string, sk: string): Promise<StoredEnvelope<T> | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk }
      })
    );
    return (response.Item as StoredEnvelope<T> | undefined) ?? null;
  }

  async queryByPkPrefix(prefix: string): Promise<Array<{ pk: string; sk: string; payload: unknown; ts_utc: string }>> {
    const response = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "begins_with(pk, :prefix)",
        ExpressionAttributeValues: {
          ":prefix": prefix
        }
      })
    );

    return (response.Items as Array<{ pk: string; sk: string; payload: unknown; ts_utc: string }> | undefined) ?? [];
  }

  async put(pk: string, sk: string, item: Record<string, unknown>): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk,
          sk,
          ...item
        }
      })
    );
  }
}

export class DynamoDbDecisionLedgerStore implements DecisionLedgerStore {
  private readonly client: DynamoDBDocumentClient;

  constructor(private readonly tableName: string) {
    this.client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async put(pk: string, sk: string, item: Record<string, unknown>): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk,
          sk,
          ...item
        }
      })
    );
  }

  async query(
    pk: string,
    limit = 5
  ): Promise<Array<{ pk: string; sk: string; payload: unknown; ts_utc: string; event_type: string }>> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
          ":pk": pk
        },
        ScanIndexForward: false,
        Limit: limit
      })
    );

    return (
      (response.Items as Array<{ pk: string; sk: string; payload: unknown; ts_utc: string; event_type: string }> | undefined) ?? []
    );
  }
}

export async function loadOperatorState(
  store: CurrentStateStore,
  defaultMode: OperatorStatePayload["mode"]
): Promise<OperatorStatePayload> {
  const item = await store.get<OperatorStatePayload>("control#operator", "latest");
  if (!item) {
    return {
      mode: defaultMode,
      paused: false,
      flatten_requested: false,
      updated_by: "system",
      updated_at_utc: new Date(0).toISOString()
    };
  }

  return item.payload;
}
