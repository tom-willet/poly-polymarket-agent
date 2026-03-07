import type {
  EventEnvelope,
  ExecutionActionLegPayload,
  ExecutionActionPayload,
  ExecutionIntentPayload
} from "./contracts.js";
import type { ExecutionConfig } from "./executionConfig.js";
import type { ExecutionMarketState } from "./execution.js";
import type { HeartbeatHealth } from "./heartbeat.js";

export interface ExecutionOrderState {
  order_id: string;
  market_id: string;
  contract_id: string;
  side: "buy" | "sell";
  limit_price: number;
  original_size: number;
  filled_size: number;
  status: "open" | "filled" | "cancelled";
}

export interface ExecutionActionInput {
  intent: EventEnvelope<ExecutionIntentPayload>;
  marketState: ExecutionMarketState[];
  orders: ExecutionOrderState[];
  heartbeat: HeartbeatHealth;
  now_utc?: string;
}

function roundPrice(value: number): number {
  return Number(value.toFixed(4));
}

function roundSize(value: number): number {
  return Number(value.toFixed(6));
}

function buildEnvelope(
  env: "sim" | "paper" | "prod",
  payload: ExecutionActionPayload
): EventEnvelope<ExecutionActionPayload> {
  return {
    schema_version: "v1",
    env,
    event_type: "execution_action",
    service: "trade-core",
    trace_id: crypto.randomUUID(),
    ts_utc: new Date().toISOString(),
    payload
  };
}

function keyFor(marketId: string, contractId: string): string {
  return `${marketId}:${contractId}`;
}

function orderKey(order: ExecutionOrderState): string {
  return keyFor(order.market_id, order.contract_id);
}

function passivePriceUsed(intentPrice: number, orderPrice: number): boolean {
  return Math.abs(intentPrice - orderPrice) < 0.0001;
}

function crossPriceForLeg(
  leg: ExecutionIntentPayload["legs"][number],
  marketState: ExecutionMarketState
): number | null {
  const price = leg.side === "buy" ? marketState.best_ask ?? marketState.best_bid : marketState.best_bid ?? marketState.best_ask;
  if (price === null || price <= 0) {
    return null;
  }

  return roundPrice(price);
}

function remainingSize(intentLeg: ExecutionIntentPayload["legs"][number], orders: ExecutionOrderState[]): number {
  const filled = orders.reduce((sum, order) => sum + Math.min(order.filled_size, order.original_size), 0);
  return Math.max(0, roundSize(intentLeg.max_size - filled));
}

export function evaluateExecutionAction(
  input: ExecutionActionInput,
  config: ExecutionConfig
): EventEnvelope<ExecutionActionPayload> {
  const now = input.now_utc ? new Date(input.now_utc) : new Date();
  const nowMs = now.getTime();
  const startedAtMs = Date.parse(input.intent.ts_utc);
  const expiryMs = Date.parse(input.intent.payload.expiry_utc);
  const passiveWindowElapsed = nowMs - startedAtMs >= config.passiveRestingMs;

  if (input.heartbeat.active && !input.heartbeat.healthy) {
    return buildEnvelope(input.intent.env, {
      order_plan_id: input.intent.payload.order_plan_id,
      decision_id: input.intent.payload.decision_id,
      status: "halted",
      reason: "execution heartbeat is unhealthy",
      actions: []
    });
  }

  const marketByLeg = new Map(
    input.marketState.map((state) => [keyFor(state.market_id, state.contract_id), state] as const)
  );
  const ordersByLeg = new Map<string, ExecutionOrderState[]>();
  for (const order of input.orders) {
    const key = orderKey(order);
    ordersByLeg.set(key, [...(ordersByLeg.get(key) ?? []), order]);
  }

  const activeOrders = input.orders.filter((order) => order.status === "open");
  if (nowMs >= expiryMs && input.intent.payload.cancel_if_unfilled && activeOrders.length > 0) {
    return buildEnvelope(input.intent.env, {
      order_plan_id: input.intent.payload.order_plan_id,
      decision_id: input.intent.payload.decision_id,
      status: "cancel_requested",
      reason: "execution intent expired with open orders",
      actions: activeOrders.map((order) => ({
        market_id: order.market_id,
        contract_id: order.contract_id,
        side: order.side,
        action: "cancel",
        order_id: order.order_id,
        limit_price: null,
        size: roundSize(Math.max(0, order.original_size - order.filled_size))
      }))
    });
  }

  const actions: ExecutionActionLegPayload[] = [];
  let hasRemaining = false;

  for (const leg of input.intent.payload.legs) {
    const key = keyFor(leg.market_id, leg.contract_id);
    const legOrders = ordersByLeg.get(key) ?? [];
    const legOpenOrders = legOrders.filter((order) => order.status === "open");
    const remaining = remainingSize(leg, legOrders);

    if (remaining <= 0) {
      continue;
    }

    hasRemaining = true;
    const marketState = marketByLeg.get(key);
    if (!marketState) {
      return buildEnvelope(input.intent.env, {
        order_plan_id: input.intent.payload.order_plan_id,
        decision_id: input.intent.payload.decision_id,
        status: "halted",
        reason: `missing execution market state for ${key}`,
        actions: []
      });
    }

    const passiveOrders = legOrders.filter((order) => passivePriceUsed(leg.limit_price, order.limit_price));
    const openPassiveOrders = legOpenOrders.filter((order) => passivePriceUsed(leg.limit_price, order.limit_price));
    const crossOrders = legOrders.filter((order) => !passivePriceUsed(leg.limit_price, order.limit_price));
    const openCrossOrders = legOpenOrders.filter((order) => !passivePriceUsed(leg.limit_price, order.limit_price));

    if (input.intent.payload.execution_style === "passive_then_cross" && !passiveWindowElapsed) {
      if (openPassiveOrders.length === 0) {
        actions.push({
          market_id: leg.market_id,
          contract_id: leg.contract_id,
          side: leg.side,
          action: "place_passive",
          limit_price: leg.limit_price,
          size: remaining
        });
      }
      continue;
    }

    if (input.intent.payload.execution_style === "passive_then_cross" && openPassiveOrders.length > 0) {
      for (const order of openPassiveOrders) {
        actions.push({
          market_id: leg.market_id,
          contract_id: leg.contract_id,
          side: leg.side,
          action: "cancel",
          order_id: order.order_id,
          limit_price: null,
          size: roundSize(Math.max(0, order.original_size - order.filled_size))
        });
      }
      continue;
    }

    if (openCrossOrders.length > 0) {
      continue;
    }

    const price = crossPriceForLeg(leg, marketState);
    if (price === null) {
      return buildEnvelope(input.intent.env, {
        order_plan_id: input.intent.payload.order_plan_id,
        decision_id: input.intent.payload.decision_id,
        status: "halted",
        reason: `no executable price available for ${key}`,
        actions: []
      });
    }

    const shouldCross =
      input.intent.payload.execution_style === "cross_only" ||
      passiveOrders.length > 0 ||
      crossOrders.length > 0 ||
      passiveWindowElapsed;

    if (shouldCross) {
      actions.push({
        market_id: leg.market_id,
        contract_id: leg.contract_id,
        side: leg.side,
        action: "place_cross",
        limit_price: price,
        size: remaining
      });
    }
  }

  if (!hasRemaining) {
    return buildEnvelope(input.intent.env, {
      order_plan_id: input.intent.payload.order_plan_id,
      decision_id: input.intent.payload.decision_id,
      status: "completed",
      reason: "all intent legs are fully filled",
      actions: []
    });
  }

  if (actions.length === 0) {
    return buildEnvelope(input.intent.env, {
      order_plan_id: input.intent.payload.order_plan_id,
      decision_id: input.intent.payload.decision_id,
      status: "waiting",
      reason: "existing open orders are still working",
      actions: []
    });
  }

  const status = actions.some((action) => action.action === "cancel") ? "cancel_requested" : "ready";
  const reason =
    status === "cancel_requested"
      ? "passive orders must be canceled before escalation or expiry cleanup"
      : "execution actions are ready";

  return buildEnvelope(input.intent.env, {
    order_plan_id: input.intent.payload.order_plan_id,
    decision_id: input.intent.payload.decision_id,
    status,
    reason,
    actions
  });
}
