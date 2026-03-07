import type { EventEnvelope, ExecutionIntentPayload, OrderEventPayload } from "./contracts.js";

export interface UserOrderChannelEvent {
  event_type: "order";
  id: string;
  market: string;
  asset_id: string;
  side: "BUY" | "SELL";
  price: string;
  original_size: string;
  size_matched: string;
  timestamp: string;
  type: "PLACEMENT" | "UPDATE" | "CANCELLATION";
}

export interface UserTradeMakerOrder {
  order_id: string;
  matched_amount: string;
}

export interface UserTradeChannelEvent {
  event_type: "trade";
  id: string;
  market: string;
  asset_id: string;
  side: "BUY" | "SELL";
  price: string;
  size: string;
  status: string;
  matchtime: string;
  last_update: string;
  taker_order_id?: string;
  maker_orders?: UserTradeMakerOrder[];
}

export type UserChannelEvent = UserOrderChannelEvent | UserTradeChannelEvent;

interface ReconciledOrderState {
  orderId: string;
  marketId: string;
  contractId: string;
  side: "buy" | "sell";
  limitPrice: number | null;
  originalSize: number;
  filledSize: number;
}

function parseNumber(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function toUtc(value: string): string {
  if (/^\d+$/.test(value)) {
    const numeric = Number.parseInt(value, 10);
    const tsMs = value.length > 10 ? numeric : numeric * 1000;
    return new Date(tsMs).toISOString();
  }

  return new Date(Date.parse(value)).toISOString();
}

function buildOrderEvent(
  env: "sim" | "paper" | "prod",
  payload: OrderEventPayload
): EventEnvelope<OrderEventPayload> {
  return {
    schema_version: "v1",
    env,
    event_type: "order_event",
    service: "trade-core",
    trace_id: crypto.randomUUID(),
    ts_utc: payload.event_ts_utc,
    payload
  };
}

export class ExecutionReconciler {
  private readonly orders = new Map<string, ReconciledOrderState>();
  private readonly contractToPlanId = new Map<string, string>();

  constructor(private readonly env: "sim" | "paper" | "prod") {}

  registerIntent(intent: ExecutionIntentPayload): void {
    for (const leg of intent.legs) {
      this.contractToPlanId.set(`${leg.market_id}:${leg.contract_id}`, intent.order_plan_id);
    }
  }

  ingest(event: UserChannelEvent): EventEnvelope<OrderEventPayload>[] {
    if (event.event_type === "order") {
      return [this.ingestOrder(event)];
    }

    return this.ingestTrade(event);
  }

  snapshot(): { open_orders: number; tracked_orders: number } {
    const openOrders = [...this.orders.values()].filter((order) => order.filledSize < order.originalSize).length;
    return {
      open_orders: openOrders,
      tracked_orders: this.orders.size
    };
  }

  private ingestOrder(event: UserOrderChannelEvent): EventEnvelope<OrderEventPayload> {
    const originalSize = parseNumber(event.original_size);
    const matchedSize = parseNumber(event.size_matched);
    const state: ReconciledOrderState = {
      orderId: event.id,
      marketId: event.market,
      contractId: event.asset_id,
      side: event.side === "BUY" ? "buy" : "sell",
      limitPrice: parseNumber(event.price),
      originalSize,
      filledSize: matchedSize
    };
    this.orders.set(event.id, state);

    const status =
      event.type === "PLACEMENT"
        ? "placed"
        : event.type === "CANCELLATION"
          ? "cancelled"
          : matchedSize >= originalSize
            ? "filled"
            : "partially_filled";

    return buildOrderEvent(this.env, {
      order_plan_id: this.contractToPlanId.get(`${event.market}:${event.asset_id}`) ?? "unknown",
      order_id: event.id,
      market_id: event.market,
      contract_id: event.asset_id,
      status,
      side: state.side,
      limit_price: state.limitPrice,
      filled_size: matchedSize,
      remaining_size: Math.max(0, Number((originalSize - matchedSize).toFixed(6))),
      event_ts_utc: toUtc(event.timestamp)
    });
  }

  private ingestTrade(event: UserTradeChannelEvent): EventEnvelope<OrderEventPayload>[] {
    const orderEvents: EventEnvelope<OrderEventPayload>[] = [];
    const makerOrders = event.maker_orders ?? [];

    for (const makerOrder of makerOrders) {
      const tracked = this.orders.get(makerOrder.order_id);
      if (!tracked) {
        continue;
      }

      tracked.filledSize = parseNumber(makerOrder.matched_amount);
      const remainingSize = Math.max(0, Number((tracked.originalSize - tracked.filledSize).toFixed(6)));
      orderEvents.push(
        buildOrderEvent(this.env, {
          order_plan_id: this.contractToPlanId.get(`${tracked.marketId}:${tracked.contractId}`) ?? "unknown",
          order_id: tracked.orderId,
          market_id: tracked.marketId,
          contract_id: tracked.contractId,
          status: remainingSize === 0 ? "filled" : "trade_update",
          side: tracked.side,
          limit_price: tracked.limitPrice,
          filled_size: tracked.filledSize,
          remaining_size: remainingSize,
          event_ts_utc: toUtc(event.last_update)
        })
      );
    }

    if (orderEvents.length === 0 && event.taker_order_id) {
      const tracked = this.orders.get(event.taker_order_id);
      if (tracked) {
        tracked.filledSize = Math.min(tracked.originalSize, tracked.filledSize + parseNumber(event.size));
        const remainingSize = Math.max(0, Number((tracked.originalSize - tracked.filledSize).toFixed(6)));
        orderEvents.push(
          buildOrderEvent(this.env, {
            order_plan_id: this.contractToPlanId.get(`${tracked.marketId}:${tracked.contractId}`) ?? "unknown",
            order_id: tracked.orderId,
            market_id: tracked.marketId,
            contract_id: tracked.contractId,
            status: remainingSize === 0 ? "filled" : "trade_update",
            side: tracked.side,
            limit_price: tracked.limitPrice,
            filled_size: tracked.filledSize,
            remaining_size: remainingSize,
            event_ts_utc: toUtc(event.last_update)
          })
        );
      }
    }

    return orderEvents;
  }
}
