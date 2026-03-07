const DEFAULT_GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const DEFAULT_MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MARKET_DATA_STALE_AFTER_MS = 5_000;

export interface AppConfig {
  env: "sim" | "paper" | "prod";
  gammaBaseUrl: string;
  marketWsUrl: string;
  gammaPageSize: number;
  gammaMaxPages: number;
  marketDataStaleAfterMs: number;
  includeRestricted: boolean;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer but received "${value}"`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

export function loadConfig(): AppConfig {
  const env = (process.env.RUNTIME_MODE ?? "paper") as AppConfig["env"];
  if (!["sim", "paper", "prod"].includes(env)) {
    throw new Error(`Unsupported RUNTIME_MODE "${env}"`);
  }

  return {
    env,
    gammaBaseUrl: process.env.POLY_GAMMA_BASE_URL ?? DEFAULT_GAMMA_BASE_URL,
    marketWsUrl: process.env.POLY_MARKET_WS_URL ?? DEFAULT_MARKET_WS_URL,
    gammaPageSize: parsePositiveInt(process.env.POLY_GAMMA_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    gammaMaxPages: parsePositiveInt(process.env.POLY_GAMMA_MAX_PAGES, DEFAULT_MAX_PAGES),
    marketDataStaleAfterMs: parsePositiveInt(
      process.env.POLY_MARKET_DATA_STALE_AFTER_MS,
      DEFAULT_MARKET_DATA_STALE_AFTER_MS
    ),
    includeRestricted: parseBoolean(process.env.POLYMARKET_INCLUDE_RESTRICTED, true)
  };
}
