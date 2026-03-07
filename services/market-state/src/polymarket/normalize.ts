import type { UniverseContract, UniverseMarketRecord } from "../contracts.js";
import type { GammaMarket } from "./gammaTypes.js";
import { parseJsonArray, parseNumber } from "./json.js";

function buildMarketComplexId(market: GammaMarket): string {
  const primaryEvent = market.events?.[0];
  if (primaryEvent?.id !== undefined && primaryEvent?.id !== null) {
    return `event:${String(primaryEvent.id)}`;
  }

  return `market:${String(market.id)}`;
}

function normalizeContracts(market: GammaMarket): UniverseContract[] {
  const outcomes = parseJsonArray(market.outcomes);
  const outcomePrices = parseJsonArray(market.outcomePrices).map((value) => parseNumber(value));
  const tokenIds = parseJsonArray(market.clobTokenIds);

  return outcomes.map((outcome, index) => ({
    contract_id: tokenIds[index] ?? `${String(market.id)}:${outcome}`,
    outcome,
    token_id: tokenIds[index] ?? null,
    last_trade_price: outcomePrices[index] ?? parseNumber(market.lastTradePrice),
    best_bid: index === 0 ? parseNumber(market.bestBid) : null,
    best_ask: index === 0 ? parseNumber(market.bestAsk) : null
  }));
}

export function normalizeGammaMarket(market: GammaMarket): UniverseMarketRecord {
  const spread = parseNumber(market.spread);
  const eventId = market.events?.[0]?.id !== undefined ? String(market.events[0].id) : null;

  return {
    market_id: String(market.id),
    event_id: eventId,
    market_complex_id: buildMarketComplexId(market),
    slug: market.slug ?? String(market.id),
    question: market.question ?? "",
    status: market.active ? "active" : "inactive",
    active: Boolean(market.active),
    accepting_orders: Boolean(market.acceptingOrders),
    enable_order_book: Boolean(market.enableOrderBook),
    approved: Boolean(market.approved),
    restricted: Boolean(market.restricted),
    archived: Boolean(market.archived),
    closed: Boolean(market.closed),
    liquidity_usd: parseNumber(market.liquidityNum ?? market.liquidity),
    volume_24h_usd: parseNumber(market.volume24hr),
    volume_total_usd: parseNumber(market.volumeNum ?? market.volume),
    spread_cents: spread === null ? null : Number((spread * 100).toFixed(3)),
    order_price_min_tick_size: parseNumber(market.orderPriceMinTickSize),
    order_min_size: parseNumber(market.orderMinSize),
    end_date_utc: market.endDate ?? null,
    tags: (market.tags ?? []).map((tag) => tag.slug ?? tag.label ?? "").filter(Boolean),
    contracts: normalizeContracts(market),
    ingest_source: "gamma-markets"
  };
}
