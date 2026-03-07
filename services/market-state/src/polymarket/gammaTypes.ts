export interface GammaEventSummary {
  id: string | number;
  slug?: string;
  title?: string;
  ticker?: string;
}

export interface GammaTag {
  slug?: string;
  label?: string;
}

export interface GammaMarket {
  id: string | number;
  question?: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  acceptingOrders?: boolean;
  enableOrderBook?: boolean;
  approved?: boolean;
  restricted?: boolean;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  liquidity?: string | number;
  liquidityNum?: number;
  volume?: string | number;
  volume24hr?: number;
  volumeNum?: number;
  spread?: number;
  bestBid?: number;
  bestAsk?: number;
  lastTradePrice?: number;
  orderPriceMinTickSize?: number;
  orderMinSize?: number;
  endDate?: string;
  tags?: GammaTag[];
  events?: GammaEventSummary[];
}
