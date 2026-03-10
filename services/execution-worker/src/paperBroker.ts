import type { ExecutionActionPayload, ExecutionIntentPayload, ExecutionMarketState, ExecutionOrderState } from "@poly/trade-core";
import type { CurrentStateStore, DecisionLedgerStore, PositionSnapshotPayload } from "@poly/openclaw-control";
import type { ExecutionWorkerConfig } from "./config.js";

export interface PaperOrderPayload {
  paper_order_id: string;
  wallet_id: string;
  order_plan_id: string;
  decision_id: string;
  sleeve_id: string;
  market_complex_id: string;
  market_id: string;
  contract_id: string;
  side: "buy" | "sell";
  order_style: "passive" | "cross";
  status: "open" | "filled" | "cancelled";
  limit_price: number;
  requested_size: number;
  filled_size: number;
  remaining_size: number;
  avg_fill_price: number | null;
  created_at_utc: string;
  updated_at_utc: string;
}

interface PaperFillPayload {
  paper_fill_id: string;
  paper_order_id: string;
  wallet_id: string;
  order_plan_id: string;
  decision_id: string;
  sleeve_id: string;
  market_complex_id: string;
  market_id: string;
  contract_id: string;
  side: "buy" | "sell";
  liquidity: "passive" | "cross";
  fill_price: number;
  fill_size: number;
  fill_notional_usd: number;
  fill_ts_utc: string;
}

interface PaperCashSnapshotPayload {
  wallet_id: string;
  starting_cash_usd: number;
  cash_balance_usd: number;
  reserved_cash_usd: number;
  available_cash_usd: number;
  realized_pnl_usd: number;
  updated_at_utc: string;
}

interface PaperPositionStatePayload {
  wallet_id: string;
  sleeve_id: string;
  market_complex_id: string;
  market_id: string;
  contract_id: string;
  quantity: number;
  avg_cost: number;
  realized_pnl_usd: number;
  updated_at_utc: string;
}

export interface PaperBrokerSummary {
  order_updates: number;
  fill_updates: number;
  cash_updates: number;
  position_state_updates: number;
  position_snapshots: number;
  notes: string[];
}

interface StoredEnvelope<T> {
  payload: T;
  ts_utc: string;
  event_type: string;
}

interface CurrentStateEvent<T> {
  schema_version: "v1";
  env: "sim" | "paper" | "prod";
  event_type: string;
  service: "execution-worker";
  trace_id: string;
  ts_utc: string;
  payload: T;
}

const EPSILON = 1e-9;

function round(value: number): number {
  return Number(value.toFixed(6));
}

function roundUsd(value: number): number {
  return Number(value.toFixed(2));
}

function buildEvent<T>(
  env: ExecutionWorkerConfig["env"],
  eventType: string,
  payload: T,
  tsUtc: string
): CurrentStateEvent<T> {
  return {
    schema_version: "v1",
    env,
    event_type: eventType,
    service: "execution-worker",
    trace_id: crypto.randomUUID(),
    ts_utc: tsUtc,
    payload
  };
}

async function persistEvent<T>(
  currentState: CurrentStateStore,
  decisionLedger: DecisionLedgerStore,
  pk: string,
  sk: string,
  event: CurrentStateEvent<T>
): Promise<void> {
  const item = { ...event } satisfies Record<string, unknown>;
  await currentState.put(pk, sk, item);
  await decisionLedger.put(pk, event.ts_utc, item);
}

async function putLatest<T>(
  currentState: CurrentStateStore,
  pk: string,
  event: CurrentStateEvent<T>
): Promise<void> {
  await currentState.put(pk, "latest", { ...event } satisfies Record<string, unknown>);
}

async function getLatest<T>(currentState: CurrentStateStore, pk: string): Promise<StoredEnvelope<T> | null> {
  return currentState.get<T>(pk, "latest");
}

export function paperWalletId(baseWalletAddress: string | null | undefined): string {
  return `paper:${baseWalletAddress && baseWalletAddress.length > 0 ? baseWalletAddress : "default"}`;
}

export async function loadPaperOrdersForIntent(
  currentState: CurrentStateStore,
  orderPlanId: string
): Promise<PaperOrderPayload[]> {
  const rows = await currentState.queryByPkPrefix("paper_order#");
  return rows
    .filter((row) => row.sk === "latest")
    .map((row) => row.payload as PaperOrderPayload)
    .filter((row) => row.order_plan_id === orderPlanId)
    .sort((left, right) => left.created_at_utc.localeCompare(right.created_at_utc));
}

export function toExecutionOrderState(orders: PaperOrderPayload[]): ExecutionOrderState[] {
  return orders.map((order) => ({
    order_id: order.paper_order_id,
    market_id: order.market_id,
    contract_id: order.contract_id,
    side: order.side,
    limit_price: order.limit_price,
    original_size: round(order.requested_size),
    filled_size: round(order.filled_size),
    status: order.status
  }));
}

function marketMap(marketState: ExecutionMarketState[]): Map<string, ExecutionMarketState> {
  return new Map(marketState.map((state) => [`${state.market_id}:${state.contract_id}`, state] as const));
}

function executablePrice(order: PaperOrderPayload, market: ExecutionMarketState): number | null {
  if (order.side === "buy") {
    if (market.best_ask === null || market.best_ask - order.limit_price > EPSILON) {
      return null;
    }
    return market.best_ask;
  }

  if (market.best_bid === null || order.limit_price - market.best_bid > EPSILON) {
    return null;
  }
  return market.best_bid;
}

function executableSize(order: PaperOrderPayload, market: ExecutionMarketState): number {
  const depth = order.side === "buy" ? market.top_ask_size : market.top_bid_size;
  if (depth === null || depth <= 0) {
    return round(order.remaining_size);
  }

  return round(Math.max(0, Math.min(order.remaining_size, depth)));
}

function mergeFill(order: PaperOrderPayload, fillPrice: number, fillSize: number, tsUtc: string): PaperOrderPayload {
  const totalFilled = round(order.filled_size + fillSize);
  const totalNotional =
    (order.avg_fill_price === null ? 0 : order.avg_fill_price * order.filled_size) + fillPrice * fillSize;
  return {
    ...order,
    status: totalFilled + EPSILON >= order.requested_size ? "filled" : "open",
    filled_size: totalFilled,
    remaining_size: round(Math.max(0, order.requested_size - totalFilled)),
    avg_fill_price: totalFilled > 0 ? round(totalNotional / totalFilled) : null,
    updated_at_utc: tsUtc
  };
}

function signedQuantity(side: "buy" | "sell", size: number): number {
  return side === "buy" ? size : -size;
}

function realizeAgainstPosition(
  position: PaperPositionStatePayload,
  side: "buy" | "sell",
  fillSize: number,
  fillPrice: number,
  tsUtc: string
): PaperPositionStatePayload {
  const delta = signedQuantity(side, fillSize);
  const currentQty = position.quantity;
  const nextQty = round(currentQty + delta);

  if (Math.abs(currentQty) < EPSILON || Math.sign(currentQty) === Math.sign(delta)) {
    const grossCurrent = Math.abs(currentQty);
    const grossAdded = Math.abs(delta);
    const nextAvg =
      grossCurrent + grossAdded <= EPSILON
        ? 0
        : round((position.avg_cost * grossCurrent + fillPrice * grossAdded) / (grossCurrent + grossAdded));
    return {
      ...position,
      quantity: nextQty,
      avg_cost: nextAvg,
      updated_at_utc: tsUtc
    };
  }

  const closingSize = Math.min(Math.abs(currentQty), Math.abs(delta));
  const realizedDelta =
    currentQty > 0
      ? round((fillPrice - position.avg_cost) * closingSize)
      : round((position.avg_cost - fillPrice) * closingSize);

  if (Math.abs(nextQty) < EPSILON) {
    return {
      ...position,
      quantity: 0,
      avg_cost: 0,
      realized_pnl_usd: round(position.realized_pnl_usd + realizedDelta),
      updated_at_utc: tsUtc
    };
  }

  if (Math.sign(nextQty) === Math.sign(currentQty)) {
    return {
      ...position,
      quantity: nextQty,
      realized_pnl_usd: round(position.realized_pnl_usd + realizedDelta),
      updated_at_utc: tsUtc
    };
  }

  return {
    ...position,
    quantity: nextQty,
    avg_cost: round(fillPrice),
    realized_pnl_usd: round(position.realized_pnl_usd + realizedDelta),
    updated_at_utc: tsUtc
  };
}

async function loadCashSnapshot(
  currentState: CurrentStateStore,
  walletId: string,
  startingCashUsd: number,
  tsUtc: string
): Promise<PaperCashSnapshotPayload> {
  const existing = await getLatest<PaperCashSnapshotPayload>(currentState, `paper_cash#${walletId}`);
  if (existing) {
    return existing.payload;
  }

  return {
    wallet_id: walletId,
    starting_cash_usd: roundUsd(startingCashUsd),
    cash_balance_usd: roundUsd(startingCashUsd),
    reserved_cash_usd: 0,
    available_cash_usd: roundUsd(startingCashUsd),
    realized_pnl_usd: 0,
    updated_at_utc: tsUtc
  };
}

export async function ensurePaperCashSnapshot(
  config: ExecutionWorkerConfig,
  currentState: CurrentStateStore,
  decisionLedger: DecisionLedgerStore,
  walletId: string,
  tsUtc: string
): Promise<number> {
  const existing = await getLatest<PaperCashSnapshotPayload>(currentState, `paper_cash#${walletId}`);
  const seeded = await loadCashSnapshot(currentState, walletId, config.paperStartingCashUsd, tsUtc);
  const recomputed = await recomputeCashSnapshot(currentState, seeded, walletId);
  const changed =
    !existing ||
    JSON.stringify(existing.payload) !==
      JSON.stringify({
        ...recomputed
      });
  if (!changed) {
    return 0;
  }

  await persistPaperCash(config, currentState, decisionLedger, recomputed, tsUtc);
  return 1;
}

async function loadPositionState(
  currentState: CurrentStateStore,
  walletId: string,
  contractId: string,
  defaults: Pick<PaperPositionStatePayload, "sleeve_id" | "market_complex_id" | "market_id">,
  tsUtc: string
): Promise<PaperPositionStatePayload> {
  const existing = await getLatest<PaperPositionStatePayload>(
    currentState,
    `paper_position_state#${walletId}#${contractId}`
  );
  if (existing) {
    return existing.payload;
  }

  return {
    wallet_id: walletId,
    contract_id: contractId,
    sleeve_id: defaults.sleeve_id,
    market_complex_id: defaults.market_complex_id,
    market_id: defaults.market_id,
    quantity: 0,
    avg_cost: 0,
    realized_pnl_usd: 0,
    updated_at_utc: tsUtc
  };
}

async function recomputeCashSnapshot(
  currentState: CurrentStateStore,
  cash: PaperCashSnapshotPayload,
  walletId: string
): Promise<PaperCashSnapshotPayload> {
  const openOrders = (await currentState.queryByPkPrefix("paper_order#"))
    .filter((row) => row.sk === "latest")
    .map((row) => row.payload as PaperOrderPayload)
    .filter((order) => order.wallet_id === walletId && order.status === "open" && order.side === "buy");
  const reserved = roundUsd(openOrders.reduce((sum, order) => sum + order.remaining_size * order.limit_price, 0));
  return {
    ...cash,
    reserved_cash_usd: reserved,
    available_cash_usd: roundUsd(cash.cash_balance_usd - reserved)
  };
}

async function updateAggregatedPositionSnapshot(
  config: ExecutionWorkerConfig,
  currentState: CurrentStateStore,
  decisionLedger: DecisionLedgerStore,
  walletId: string,
  marketComplexId: string,
  tsUtc: string,
  marketByContract: Map<string, ExecutionMarketState>
): Promise<number> {
  const positionStates = (await currentState.queryByPkPrefix(`paper_position_state#${walletId}#`))
    .filter((row) => row.sk === "latest")
    .map((row) => row.payload as PaperPositionStatePayload)
    .filter((row) => row.market_complex_id === marketComplexId);
  const openOrders = (await currentState.queryByPkPrefix("paper_order#"))
    .filter((row) => row.sk === "latest")
    .map((row) => row.payload as PaperOrderPayload)
    .filter((row) => row.wallet_id === walletId && row.market_complex_id === marketComplexId && row.status === "open");

  if (positionStates.length === 0 && openOrders.length === 0) {
    return 0;
  }

  const grossExposureUsd = roundUsd(
    positionStates.reduce((sum, position) => {
      const market = marketByContract.get(`${position.market_id}:${position.contract_id}`);
      const markPrice = market?.best_bid ?? market?.best_ask ?? position.avg_cost;
      return sum + Math.abs(position.quantity) * Math.max(markPrice, 0);
    }, 0)
  );
  const netExposureUsd = roundUsd(
    positionStates.reduce((sum, position) => {
      const market = marketByContract.get(`${position.market_id}:${position.contract_id}`);
      const markPrice = market?.best_bid ?? market?.best_ask ?? position.avg_cost;
      return sum + position.quantity * Math.max(markPrice, 0);
    }, 0)
  );
  const unrealizedPnlUsd = roundUsd(
    positionStates.reduce((sum, position) => {
      const market = marketByContract.get(`${position.market_id}:${position.contract_id}`);
      const markPrice = market?.best_bid ?? market?.best_ask ?? position.avg_cost;
      if (position.quantity > 0) {
        return sum + position.quantity * (markPrice - position.avg_cost);
      }
      if (position.quantity < 0) {
        return sum + Math.abs(position.quantity) * (position.avg_cost - markPrice);
      }
      return sum;
    }, 0)
  );
  const realizedPnlUsd = roundUsd(positionStates.reduce((sum, position) => sum + position.realized_pnl_usd, 0));
  const openOrdersReservedUsd = roundUsd(
    openOrders.reduce((sum, order) => sum + order.remaining_size * order.limit_price, 0)
  );
  const snapshot: PositionSnapshotPayload = {
    wallet_id: walletId,
    sleeve_id: positionStates[0]?.sleeve_id ?? openOrders[0]?.sleeve_id ?? "paper",
    market_complex_id: marketComplexId,
    gross_exposure_usd: grossExposureUsd,
    net_exposure_usd: netExposureUsd,
    realized_pnl_usd: realizedPnlUsd,
    unrealized_pnl_usd: unrealizedPnlUsd,
    open_orders_reserved_usd: openOrdersReservedUsd,
    snapshot_ts_utc: tsUtc
  };
  const event = buildEvent(config.env, "position_snapshot", snapshot, tsUtc);
  const item = { ...event } satisfies Record<string, unknown>;
  await currentState.put(`position#${walletId}#${marketComplexId}`, "snapshot", item);
  await decisionLedger.put(`position_snapshot#${walletId}#${marketComplexId}`, tsUtc, item);
  return 1;
}

async function persistPaperOrder(
  config: ExecutionWorkerConfig,
  currentState: CurrentStateStore,
  decisionLedger: DecisionLedgerStore,
  order: PaperOrderPayload,
  tsUtc: string
): Promise<void> {
  const event = buildEvent(config.env, "paper_order", order, tsUtc);
  await persistEvent(currentState, decisionLedger, `paper_order#${order.paper_order_id}`, "latest", event);
}

async function persistPaperFill(
  config: ExecutionWorkerConfig,
  currentState: CurrentStateStore,
  decisionLedger: DecisionLedgerStore,
  fill: PaperFillPayload,
  tsUtc: string
): Promise<void> {
  const event = buildEvent(config.env, "paper_fill", fill, tsUtc);
  await persistEvent(currentState, decisionLedger, `paper_fill#${fill.paper_fill_id}`, "latest", event);
}

async function persistPaperCash(
  config: ExecutionWorkerConfig,
  currentState: CurrentStateStore,
  decisionLedger: DecisionLedgerStore,
  cash: PaperCashSnapshotPayload,
  tsUtc: string
): Promise<void> {
  const event = buildEvent(config.env, "paper_cash_snapshot", cash, tsUtc);
  await putLatest(currentState, `paper_cash#${cash.wallet_id}`, event);
  await decisionLedger.put(`paper_cash#${cash.wallet_id}`, tsUtc, { ...event } satisfies Record<string, unknown>);
}

async function persistPaperPositionState(
  config: ExecutionWorkerConfig,
  currentState: CurrentStateStore,
  decisionLedger: DecisionLedgerStore,
  position: PaperPositionStatePayload,
  tsUtc: string
): Promise<void> {
  const event = buildEvent(config.env, "paper_position_state", position, tsUtc);
  await putLatest(currentState, `paper_position_state#${position.wallet_id}#${position.contract_id}`, event);
  await decisionLedger.put(
    `paper_position_state#${position.wallet_id}#${position.contract_id}`,
    tsUtc,
    { ...event } satisfies Record<string, unknown>
  );
}

async function applyFillToPortfolio(
  config: ExecutionWorkerConfig,
  currentState: CurrentStateStore,
  decisionLedger: DecisionLedgerStore,
  walletId: string,
  order: PaperOrderPayload,
  fillPrice: number,
  fillSize: number,
  tsUtc: string
): Promise<{ cashUpdates: number; positionStateUpdates: number; fillUpdates: number }> {
  const fillNotionalUsd = roundUsd(fillPrice * fillSize);
  const fill: PaperFillPayload = {
    paper_fill_id: crypto.randomUUID(),
    paper_order_id: order.paper_order_id,
    wallet_id: walletId,
    order_plan_id: order.order_plan_id,
    decision_id: order.decision_id,
    sleeve_id: order.sleeve_id,
    market_complex_id: order.market_complex_id,
    market_id: order.market_id,
    contract_id: order.contract_id,
    side: order.side,
    liquidity: order.order_style,
    fill_price: round(fillPrice),
    fill_size: round(fillSize),
    fill_notional_usd: fillNotionalUsd,
    fill_ts_utc: tsUtc
  };
  await persistPaperFill(config, currentState, decisionLedger, fill, tsUtc);

  const currentCash = await loadCashSnapshot(currentState, walletId, config.paperStartingCashUsd, tsUtc);
  const currentPosition = await loadPositionState(
    currentState,
    walletId,
    order.contract_id,
    {
      sleeve_id: order.sleeve_id,
      market_complex_id: order.market_complex_id,
      market_id: order.market_id
    },
    tsUtc
  );
  const nextPosition = realizeAgainstPosition(currentPosition, order.side, fillSize, fillPrice, tsUtc);
  const nextCash: PaperCashSnapshotPayload = {
    ...currentCash,
    cash_balance_usd: roundUsd(
      currentCash.cash_balance_usd + (order.side === "buy" ? -fillNotionalUsd : fillNotionalUsd)
    ),
    realized_pnl_usd: roundUsd(nextPosition.realized_pnl_usd),
    updated_at_utc: tsUtc
  };
  const recomputedCash = await recomputeCashSnapshot(currentState, nextCash, walletId);

  await persistPaperPositionState(config, currentState, decisionLedger, nextPosition, tsUtc);
  await persistPaperCash(config, currentState, decisionLedger, recomputedCash, tsUtc);
  return {
    cashUpdates: 1,
    positionStateUpdates: 1,
    fillUpdates: 1
  };
}

export async function reconcilePaperOrders(
  config: ExecutionWorkerConfig,
  currentState: CurrentStateStore,
  decisionLedger: DecisionLedgerStore,
  walletId: string,
  intent: ExecutionIntentPayload,
  marketState: ExecutionMarketState[],
  tsUtc: string
): Promise<PaperBrokerSummary> {
  const orders = await loadPaperOrdersForIntent(currentState, intent.order_plan_id);
  const markets = marketMap(marketState);
  const notes: string[] = [];
  let orderUpdates = 0;
  let fillUpdates = 0;
  let cashUpdates = 0;
  let positionStateUpdates = 0;

  for (const order of orders.filter((row) => row.status === "open")) {
    const market = markets.get(`${order.market_id}:${order.contract_id}`);
    if (!market) {
      notes.push(`missing market state for ${order.contract_id} during paper reconciliation`);
      continue;
    }

    const fillPrice = executablePrice(order, market);
    if (fillPrice === null) {
      continue;
    }

    const fillSize = executableSize(order, market);
    if (fillSize <= 0) {
      continue;
    }

    const nextOrder = mergeFill(order, fillPrice, fillSize, tsUtc);
    await persistPaperOrder(config, currentState, decisionLedger, nextOrder, tsUtc);
    orderUpdates += 1;
    const portfolio = await applyFillToPortfolio(
      config,
      currentState,
      decisionLedger,
      walletId,
      nextOrder,
      fillPrice,
      fillSize,
      tsUtc
    );
    fillUpdates += portfolio.fillUpdates;
    cashUpdates += portfolio.cashUpdates;
    positionStateUpdates += portfolio.positionStateUpdates;
  }

  const snapshotUpdates = await updateAggregatedPositionSnapshot(
    config,
    currentState,
    decisionLedger,
    walletId,
    intent.market_complex_id,
    tsUtc,
    markets
  );

  return {
    order_updates: orderUpdates,
    fill_updates: fillUpdates,
    cash_updates: cashUpdates,
    position_state_updates: positionStateUpdates,
    position_snapshots: snapshotUpdates,
    notes
  };
}

export async function applyPaperExecutionAction(
  config: ExecutionWorkerConfig,
  currentState: CurrentStateStore,
  decisionLedger: DecisionLedgerStore,
  walletId: string,
  intent: ExecutionIntentPayload,
  action: ExecutionActionPayload,
  marketState: ExecutionMarketState[],
  tsUtc: string
): Promise<PaperBrokerSummary> {
  const markets = marketMap(marketState);
  const notes: string[] = [];
  let orderUpdates = 0;
  let fillUpdates = 0;
  let cashUpdates = 0;
  let positionStateUpdates = 0;

  let cash = await loadCashSnapshot(currentState, walletId, config.paperStartingCashUsd, tsUtc);
  cash = await recomputeCashSnapshot(currentState, cash, walletId);

  for (const legAction of action.actions) {
    if (legAction.action === "cancel") {
      const existing = await getLatest<PaperOrderPayload>(currentState, `paper_order#${legAction.order_id}`);
      if (!existing) {
        notes.push(`cancel requested for missing paper order ${legAction.order_id}`);
        continue;
      }

      const nextOrder: PaperOrderPayload = {
        ...existing.payload,
        status: "cancelled",
        remaining_size: 0,
        updated_at_utc: tsUtc
      };
      await persistPaperOrder(config, currentState, decisionLedger, nextOrder, tsUtc);
      orderUpdates += 1;
      cash = await recomputeCashSnapshot(currentState, cash, walletId);
      await persistPaperCash(config, currentState, decisionLedger, cash, tsUtc);
      cashUpdates += 1;
      continue;
    }

    if (legAction.limit_price === null || legAction.size <= 0) {
      notes.push(`skipped ${legAction.action} for ${legAction.contract_id} because size or price was invalid`);
      continue;
    }

    const market = markets.get(`${legAction.market_id}:${legAction.contract_id}`);
    if (!market) {
      notes.push(`missing market state for ${legAction.contract_id}`);
      continue;
    }

    const requestedSize = round(legAction.size);
    let executableSize = requestedSize;
    if (legAction.side === "buy") {
      const maxAffordable = legAction.limit_price > 0 ? cash.available_cash_usd / legAction.limit_price : 0;
      executableSize = round(Math.min(requestedSize, Math.max(0, maxAffordable)));
      if (executableSize <= 0) {
        notes.push(`insufficient paper cash to place ${legAction.action} for ${legAction.contract_id}`);
        continue;
      }
    }

    const paperOrder: PaperOrderPayload = {
      paper_order_id: crypto.randomUUID(),
      wallet_id: walletId,
      order_plan_id: intent.order_plan_id,
      decision_id: intent.decision_id,
      sleeve_id: intent.sleeve_id,
      market_complex_id: intent.market_complex_id,
      market_id: legAction.market_id,
      contract_id: legAction.contract_id,
      side: legAction.side,
      order_style: legAction.action === "place_passive" ? "passive" : "cross",
      status: legAction.action === "place_passive" ? "open" : "filled",
      limit_price: round(legAction.limit_price),
      requested_size: executableSize,
      filled_size: legAction.action === "place_passive" ? 0 : executableSize,
      remaining_size: legAction.action === "place_passive" ? executableSize : 0,
      avg_fill_price: legAction.action === "place_passive" ? null : round(legAction.limit_price),
      created_at_utc: tsUtc,
      updated_at_utc: tsUtc
    };
    await persistPaperOrder(config, currentState, decisionLedger, paperOrder, tsUtc);
    orderUpdates += 1;

    if (paperOrder.order_style === "passive") {
      cash = await recomputeCashSnapshot(currentState, cash, walletId);
      await persistPaperCash(config, currentState, decisionLedger, cash, tsUtc);
      cashUpdates += 1;
      continue;
    }

    const fillPrice =
      legAction.side === "buy"
        ? market.best_ask ?? market.best_bid ?? legAction.limit_price
        : market.best_bid ?? market.best_ask ?? legAction.limit_price;
    const portfolio = await applyFillToPortfolio(
      config,
      currentState,
      decisionLedger,
      walletId,
      paperOrder,
      fillPrice,
      paperOrder.filled_size,
      tsUtc
    );
    fillUpdates += portfolio.fillUpdates;
    cashUpdates += portfolio.cashUpdates;
    positionStateUpdates += portfolio.positionStateUpdates;
    cash = await loadCashSnapshot(currentState, walletId, config.paperStartingCashUsd, tsUtc);
  }

  const snapshotUpdates = await updateAggregatedPositionSnapshot(
    config,
    currentState,
    decisionLedger,
    walletId,
    intent.market_complex_id,
    tsUtc,
    markets
  );

  return {
    order_updates: orderUpdates,
    fill_updates: fillUpdates,
    cash_updates: cashUpdates,
    position_state_updates: positionStateUpdates,
    position_snapshots: snapshotUpdates,
    notes
  };
}
