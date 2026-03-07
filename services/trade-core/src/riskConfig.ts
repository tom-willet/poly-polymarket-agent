const DEFAULT_MAX_DAILY_LOSS_RATIO = 0.075;
const DEFAULT_MAX_WEEKLY_DRAWDOWN_RATIO = 0.15;
const DEFAULT_MAX_SPREAD_CENTS = 4;
const DEFAULT_MIN_TIME_TO_RESOLUTION_HOURS = 4;
const DEFAULT_MAX_TIME_TO_RESOLUTION_HOURS = 45 * 24;
const DEFAULT_MIN_EDGE_CENTS = 3;
const DEFAULT_COST_TO_GROSS_EDGE_RATIO = 0.5;
const DEFAULT_ORDER_BOOK_DEPTH_MULTIPLIER = 3;
const DEFAULT_REQUIRE_PROD_FOR_LIVE_EXECUTION = true;

export interface RiskConfig {
  maxDailyLossRatio: number;
  maxWeeklyDrawdownRatio: number;
  maxSpreadCents: number;
  minTimeToResolutionHours: number;
  maxTimeToResolutionHours: number;
  minEdgeCents: number;
  maxCostToGrossEdgeRatio: number;
  minDepthMultiplier: number;
  requireProdForLiveExecution: boolean;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected positive number but received "${value}"`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

export function loadRiskConfig(): RiskConfig {
  return {
    maxDailyLossRatio: parsePositiveNumber(process.env.MAX_DAILY_LOSS_RATIO, DEFAULT_MAX_DAILY_LOSS_RATIO),
    maxWeeklyDrawdownRatio: parsePositiveNumber(
      process.env.MAX_WEEKLY_DRAWDOWN_RATIO,
      DEFAULT_MAX_WEEKLY_DRAWDOWN_RATIO
    ),
    maxSpreadCents: parsePositiveNumber(process.env.MAX_SPREAD_CENTS, DEFAULT_MAX_SPREAD_CENTS),
    minTimeToResolutionHours: parsePositiveNumber(
      process.env.MIN_TIME_TO_RESOLUTION_HOURS,
      DEFAULT_MIN_TIME_TO_RESOLUTION_HOURS
    ),
    maxTimeToResolutionHours: parsePositiveNumber(
      process.env.MAX_TIME_TO_RESOLUTION_HOURS,
      DEFAULT_MAX_TIME_TO_RESOLUTION_HOURS
    ),
    minEdgeCents: parsePositiveNumber(process.env.MIN_EDGE_CENTS, DEFAULT_MIN_EDGE_CENTS),
    maxCostToGrossEdgeRatio: parsePositiveNumber(
      process.env.MAX_COST_TO_GROSS_EDGE_RATIO,
      DEFAULT_COST_TO_GROSS_EDGE_RATIO
    ),
    minDepthMultiplier: parsePositiveNumber(process.env.MIN_DEPTH_MULTIPLIER, DEFAULT_ORDER_BOOK_DEPTH_MULTIPLIER),
    requireProdForLiveExecution: parseBoolean(
      process.env.REQUIRE_PROD_FOR_LIVE_EXECUTION,
      DEFAULT_REQUIRE_PROD_FOR_LIVE_EXECUTION
    )
  };
}
