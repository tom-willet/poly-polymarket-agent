import {
  evaluateExecutionAction,
  loadExecutionConfig,
  type EventEnvelope as TradeCoreEnvelope,
  type ExecutionActionPayload,
  type ExecutionIntentPayload,
  type ExecutionMarketState,
  type ExecutionOrderState
} from "@poly/trade-core";
import type {
  AccountSnapshotPayload,
  CurrentStateStore,
  DecisionLedgerStore,
  ExecutionHeartbeatPayload,
  MarketSnapshotPayload
} from "@poly/openclaw-control";
import { loadOperatorState } from "@poly/openclaw-control";
import type { ExecutionWorkerConfig } from "./config.js";
import {
  applyPaperExecutionAction,
  ensurePaperCashSnapshot,
  flattenPaperPortfolio,
  loadPaperOrdersForIntent,
  paperWalletId,
  reconcilePaperOrders,
  toExecutionOrderState
} from "./paperBroker.js";

export interface ExecutionWorkerSummary {
  heartbeat: ExecutionHeartbeatPayload;
  scanned_intents: number;
  processed_intents: number;
  action_updates: number;
  paper_order_updates: number;
  paper_fill_updates: number;
  paper_cash_updates: number;
  paper_position_state_updates: number;
  paper_position_snapshots: number;
  notes: string[];
}

interface ExecutionIntentRow {
  pk: string;
  sk: string;
  ts_utc: string;
  payload: ExecutionIntentPayload;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function buildHeartbeat(config: ExecutionWorkerConfig, timeoutMs: number, nowUtc: string): ExecutionHeartbeatPayload {
  const healthy = config.env !== "prod";
  return {
    active: true,
    healthy,
    last_sent_ts_utc: nowUtc,
    last_ack_ts_utc: healthy ? nowUtc : null,
    heartbeat_id: healthy ? `ew-${Date.parse(nowUtc)}` : null,
    timeout_ms: timeoutMs
  };
}

function toOrderState(openOrders: NonNullable<AccountSnapshotPayload["open_orders"]>): ExecutionOrderState[] {
  return openOrders
    .map((order) => {
      const price = order.price ?? null;
      const originalSize = order.original_size ?? 0;
      const matchedSize = order.matched_size ?? 0;
      if (price === null || originalSize <= 0) {
        return null;
      }

      return {
        order_id: order.order_id,
        market_id: order.market_id,
        contract_id: order.contract_id,
        side: order.side.toUpperCase() === "BUY" ? "buy" : "sell",
        limit_price: price,
        original_size: round(originalSize),
        filled_size: round(matchedSize),
        status: order.status.toUpperCase() === "LIVE" ? "open" : order.remaining_size === 0 ? "filled" : "cancelled"
      } satisfies ExecutionOrderState;
    })
    .filter((order): order is ExecutionOrderState => order !== null);
}

function orderStateForIntent(
  accountSnapshot: AccountSnapshotPayload | null,
  intent: ExecutionIntentPayload
): ExecutionOrderState[] {
  const openOrders = accountSnapshot?.open_orders ?? [];
  if (openOrders.length === 0) {
    return [];
  }

  const intentContracts = new Set(intent.legs.map((leg) => `${leg.market_id}:${leg.contract_id}`));
  return toOrderState(openOrders).filter((order) => intentContracts.has(`${order.market_id}:${order.contract_id}`));
}

function actionEnvelopeForExpiredIntent(
  env: ExecutionWorkerConfig["env"],
  intent: ExecutionIntentPayload,
  tsUtc: string
): TradeCoreEnvelope<ExecutionActionPayload> {
  return {
    schema_version: "v1",
    env,
    event_type: "execution_action",
    service: "trade-core",
    trace_id: crypto.randomUUID(),
    ts_utc: tsUtc,
    payload: {
      order_plan_id: intent.order_plan_id,
      decision_id: intent.decision_id,
      status: "completed",
      reason: "execution intent expired before action evaluation",
      actions: []
    }
  };
}

async function loadIntentMarketState(
  currentState: CurrentStateStore,
  intent: ExecutionIntentPayload
): Promise<ExecutionMarketState[]> {
  const states = await Promise.all(
    intent.legs.map(async (leg) => {
      const item = await currentState.get<MarketSnapshotPayload>(`market#${leg.contract_id}`, "snapshot");
      if (!item) {
        throw new Error(`Missing market snapshot for ${leg.contract_id}`);
      }

      return {
        market_id: item.payload.market_id,
        contract_id: item.payload.contract_id,
        best_bid: item.payload.best_bid,
        best_ask: item.payload.best_ask,
        spread_cents: item.payload.spread_cents,
        top_bid_size: item.payload.top_bid_size,
        top_ask_size: item.payload.top_ask_size
      };
    })
  );

  return states;
}

async function loadPrimaryAccountSnapshot(currentState: CurrentStateStore): Promise<AccountSnapshotPayload | null> {
  const accounts = await currentState.queryByPkPrefix("account#");
  const snapshot = accounts
    .filter((item) => item.sk === "snapshot")
    .sort((left, right) => right.ts_utc.localeCompare(left.ts_utc))[0];
  return (snapshot?.payload as AccountSnapshotPayload | undefined) ?? null;
}

function samePayload(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function usesPaperBroker(env: ExecutionWorkerConfig["env"]): boolean {
  return env === "paper" || env === "sim";
}

async function persistHeartbeat(
  currentState: CurrentStateStore,
  env: ExecutionWorkerConfig["env"],
  heartbeat: ExecutionHeartbeatPayload,
  tsUtc: string
): Promise<void> {
  await currentState.put("health#execution-heartbeat", "latest", {
    schema_version: "v1",
    env,
    event_type: "execution_heartbeat",
    service: "execution-worker",
    trace_id: crypto.randomUUID(),
    ts_utc: tsUtc,
    payload: heartbeat
  });
}

async function persistAction(
  currentState: CurrentStateStore,
  decisionLedger: DecisionLedgerStore,
  action: TradeCoreEnvelope<ExecutionActionPayload>
): Promise<boolean> {
  const currentPk = `execution_action#${action.payload.order_plan_id}`;
  const existing = await currentState.get<ExecutionActionPayload>(currentPk, "latest");
  if (existing && samePayload(existing.payload, action.payload)) {
    return false;
  }

  await currentState.put(currentPk, "latest", {
    schema_version: action.schema_version,
    env: action.env,
    event_type: action.event_type,
    service: action.service,
    trace_id: action.trace_id,
    ts_utc: action.ts_utc,
    payload: action.payload
  });

  await decisionLedger.put(currentPk, action.ts_utc, {
    schema_version: action.schema_version,
    env: action.env,
    event_type: action.event_type,
    service: action.service,
    trace_id: action.trace_id,
    ts_utc: action.ts_utc,
    payload: action.payload
  });

  return true;
}

export async function runExecutionTick(
  config: ExecutionWorkerConfig,
  currentState: CurrentStateStore,
  decisionLedger: DecisionLedgerStore,
  now = new Date()
): Promise<ExecutionWorkerSummary> {
  const executionConfig = loadExecutionConfig();
  const nowUtc = now.toISOString();
  const heartbeat = buildHeartbeat(config, executionConfig.heartbeatTimeoutMs, nowUtc);
  await persistHeartbeat(currentState, config.env, heartbeat, nowUtc);

  const accountSnapshot = await loadPrimaryAccountSnapshot(currentState);
  const operatorState = usesPaperBroker(config.env) ? await loadOperatorState(currentState, config.env) : null;
  const rows = (await currentState.queryByPkPrefix("execution_intent#"))
    .filter((item) => item.sk === "latest")
    .sort((left, right) => right.ts_utc.localeCompare(left.ts_utc))
    .slice(0, config.maxIntentsPerTick) as ExecutionIntentRow[];

  let processedIntents = 0;
  let actionUpdates = 0;
  let paperOrderUpdates = 0;
  let paperFillUpdates = 0;
  let paperCashUpdates = 0;
  let paperPositionStateUpdates = 0;
  let paperPositionSnapshots = 0;
  const notes: string[] = [];
  const paperWallet = usesPaperBroker(config.env) ? paperWalletId(accountSnapshot?.user_address) : null;

  if (paperWallet) {
    paperCashUpdates += await ensurePaperCashSnapshot(config, currentState, decisionLedger, paperWallet, nowUtc);
  }

  if (paperWallet && operatorState?.flatten_requested) {
    const flattened = await flattenPaperPortfolio(config, currentState, decisionLedger, paperWallet, nowUtc);
    paperOrderUpdates += flattened.order_updates;
    paperFillUpdates += flattened.fill_updates;
    paperCashUpdates += flattened.cash_updates;
    paperPositionStateUpdates += flattened.position_state_updates;
    paperPositionSnapshots += flattened.position_snapshots;
    notes.push(...flattened.notes);
    if (rows.length > 0) {
      notes.push(`operator flatten requested; skipped ${rows.length} persisted execution intents`);
    }
    if (!accountSnapshot) {
      notes.push("account snapshot missing while flattening paper exposure");
    }

    return {
      heartbeat,
      scanned_intents: rows.length,
      processed_intents: 0,
      action_updates: 0,
      paper_order_updates: paperOrderUpdates,
      paper_fill_updates: paperFillUpdates,
      paper_cash_updates: paperCashUpdates,
      paper_position_state_updates: paperPositionStateUpdates,
      paper_position_snapshots: paperPositionSnapshots,
      notes
    };
  }

  for (const row of rows) {
    const intent = row.payload;
    const marketState = await loadIntentMarketState(currentState, intent);
    let orders = orderStateForIntent(accountSnapshot, intent);

    if (paperWallet) {
      const reconciliation = await reconcilePaperOrders(
        config,
        currentState,
        decisionLedger,
        paperWallet,
        intent,
        marketState,
        nowUtc
      );
      paperOrderUpdates += reconciliation.order_updates;
      paperFillUpdates += reconciliation.fill_updates;
      paperCashUpdates += reconciliation.cash_updates;
      paperPositionStateUpdates += reconciliation.position_state_updates;
      paperPositionSnapshots += reconciliation.position_snapshots;
      notes.push(...reconciliation.notes);
      orders = toExecutionOrderState(await loadPaperOrdersForIntent(currentState, intent.order_plan_id));
    }

    const action =
      Date.parse(intent.expiry_utc) <= now.getTime() && orders.length === 0
        ? actionEnvelopeForExpiredIntent(config.env, intent, nowUtc)
        : evaluateExecutionAction(
            {
              intent: {
                schema_version: "v1",
                env: config.env,
                event_type: "execution_intent",
                service: "trade-core",
                trace_id: crypto.randomUUID(),
                ts_utc: row.ts_utc,
                payload: intent
              },
              marketState,
              orders,
              heartbeat,
              now_utc: nowUtc
            },
            executionConfig
          );

    processedIntents += 1;
    if (await persistAction(currentState, decisionLedger, action)) {
      actionUpdates += 1;
    }

    if (paperWallet) {
      const applied = await applyPaperExecutionAction(
        config,
        currentState,
        decisionLedger,
        paperWallet,
        intent,
        action.payload,
        marketState,
        nowUtc
      );
      paperOrderUpdates += applied.order_updates;
      paperFillUpdates += applied.fill_updates;
      paperCashUpdates += applied.cash_updates;
      paperPositionStateUpdates += applied.position_state_updates;
      paperPositionSnapshots += applied.position_snapshots;
      notes.push(...applied.notes);
    }
  }

  if (rows.length === 0) {
    notes.push("no execution intents available");
  }

  if (!accountSnapshot) {
    notes.push("account snapshot missing; execution actions used empty order state");
  }

  return {
    heartbeat,
    scanned_intents: rows.length,
    processed_intents: processedIntents,
    action_updates: actionUpdates,
    paper_order_updates: paperOrderUpdates,
    paper_fill_updates: paperFillUpdates,
    paper_cash_updates: paperCashUpdates,
    paper_position_state_updates: paperPositionStateUpdates,
    paper_position_snapshots: paperPositionSnapshots,
    notes
  };
}
