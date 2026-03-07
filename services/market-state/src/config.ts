const DEFAULT_GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const DEFAULT_CLOB_BASE_URL = "https://clob.polymarket.com";
const DEFAULT_DATA_BASE_URL = "https://data-api.polymarket.com";
const DEFAULT_MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_MARKET_DATA_STALE_AFTER_MS = 5_000;
const DEFAULT_ACCOUNT_STATE_STALE_AFTER_MS = 15_000;
const DEFAULT_POSITIONS_SIZE_THRESHOLD = 0.1;
const DEFAULT_POSITIONS_LIMIT = 200;
const DEFAULT_STATE_ARCHIVE_PREFIX = "market-state";

interface AccountConfig {
  polyClobBaseUrl: string;
  polyDataBaseUrl: string;
  polyChainId: number;
  polySignatureType: number;
  polyUserAddress: string;
  polyFunderAddress?: string;
  polyPrivateKey?: string;
  polyClobApiKey?: string;
  polyClobApiSecret?: string;
  polyClobApiPassphrase?: string;
  accountStateStaleAfterMs: number;
  polyPositionsSizeThreshold: number;
  polyPositionsLimit: number;
}

interface StatePersistenceConfig {
  stateCurrentTableName?: string;
  stateArchiveBucketName?: string;
  stateArchivePrefix: string;
}

export interface AppConfig extends AccountConfig, StatePersistenceConfig {
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

export function loadConfig(): AppConfig {
  const env = (process.env.RUNTIME_MODE ?? "paper") as AppConfig["env"];
  if (!["sim", "paper", "prod"].includes(env)) {
    throw new Error(`Unsupported RUNTIME_MODE "${env}"`);
  }

  return {
    env,
    gammaBaseUrl: process.env.POLY_GAMMA_BASE_URL ?? DEFAULT_GAMMA_BASE_URL,
    polyClobBaseUrl: process.env.POLY_CLOB_BASE_URL ?? DEFAULT_CLOB_BASE_URL,
    polyDataBaseUrl: process.env.POLY_DATA_BASE_URL ?? DEFAULT_DATA_BASE_URL,
    marketWsUrl: process.env.POLY_MARKET_WS_URL ?? DEFAULT_MARKET_WS_URL,
    gammaPageSize: parsePositiveInt(process.env.POLY_GAMMA_PAGE_SIZE, DEFAULT_PAGE_SIZE),
    gammaMaxPages: parsePositiveInt(process.env.POLY_GAMMA_MAX_PAGES, DEFAULT_MAX_PAGES),
    marketDataStaleAfterMs: parsePositiveInt(
      process.env.POLY_MARKET_DATA_STALE_AFTER_MS,
      DEFAULT_MARKET_DATA_STALE_AFTER_MS
    ),
    accountStateStaleAfterMs: parsePositiveInt(
      process.env.POLY_ACCOUNT_STATE_STALE_AFTER_MS,
      DEFAULT_ACCOUNT_STATE_STALE_AFTER_MS
    ),
    polyChainId: parsePositiveInt(process.env.POLY_CHAIN_ID, 137),
    polySignatureType: parsePositiveInt(process.env.POLY_SIGNATURE_TYPE, 0),
    polyUserAddress: process.env.POLY_USER_ADDRESS ?? "",
    polyFunderAddress: process.env.POLY_FUNDER_ADDRESS || undefined,
    polyPrivateKey: process.env.POLY_PRIVATE_KEY || undefined,
    polyClobApiKey: process.env.POLY_CLOB_API_KEY || undefined,
    polyClobApiSecret: process.env.POLY_CLOB_API_SECRET || undefined,
    polyClobApiPassphrase: process.env.POLY_CLOB_API_PASSPHRASE || undefined,
    polyPositionsSizeThreshold: parsePositiveNumber(
      process.env.POLY_POSITIONS_SIZE_THRESHOLD,
      DEFAULT_POSITIONS_SIZE_THRESHOLD
    ),
    polyPositionsLimit: parsePositiveInt(process.env.POLY_POSITIONS_LIMIT, DEFAULT_POSITIONS_LIMIT),
    stateCurrentTableName: process.env.STATE_CURRENT_TABLE || undefined,
    stateArchiveBucketName: process.env.STATE_ARCHIVE_BUCKET || undefined,
    stateArchivePrefix: process.env.STATE_ARCHIVE_PREFIX ?? DEFAULT_STATE_ARCHIVE_PREFIX,
    includeRestricted: parseBoolean(process.env.POLYMARKET_INCLUDE_RESTRICTED, true)
  };
}
