export interface BookLevelMessage {
  price: string;
  size: string;
}

export interface MarketBookEvent {
  event_type: "book";
  asset_id: string;
  market: string;
  bids: BookLevelMessage[];
  asks: BookLevelMessage[];
  timestamp: string;
}

export interface MarketBestBidAskEvent {
  event_type: "best_bid_ask";
  asset_id: string;
  market: string;
  best_bid: string;
  best_ask: string;
  spread: string;
  timestamp: string;
}

export interface MarketLastTradePriceEvent {
  event_type: "last_trade_price";
  asset_id: string;
  market: string;
  price: string;
  size: string;
  side: string;
  timestamp: string;
}

export interface MarketPriceChangeEntry {
  asset_id: string;
  price: string;
  size: string;
  side: string;
  hash: string;
  best_bid: string;
  best_ask: string;
}

export interface MarketPriceChangeEvent {
  event_type: "price_change";
  market: string;
  timestamp: string;
  price_changes: MarketPriceChangeEntry[];
}

export type MarketChannelEvent =
  | MarketBookEvent
  | MarketBestBidAskEvent
  | MarketLastTradePriceEvent
  | MarketPriceChangeEvent;
