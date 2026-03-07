export interface DataApiPosition {
  user?: string;
  proxyWallet?: string;
  asset?: string;
  market?: string;
  conditionId?: string;
  outcome?: string;
  size?: string | number;
  avgPrice?: string | number;
  currentValue?: string | number;
  cashPnl?: string | number;
  curPrice?: string | number;
  redeemable?: boolean | string | number;
  title?: string;
  slug?: string;
  eventSlug?: string;
  endDate?: string;
}
