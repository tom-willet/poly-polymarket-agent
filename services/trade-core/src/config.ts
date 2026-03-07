const DEFAULT_BANKROLL_USD = 1000;
const DEFAULT_MAX_GROSS_EXPOSURE_RATIO = 0.7;
const DEFAULT_MAX_SLEEVE_EXPOSURE_RATIO = 0.35;
const DEFAULT_MAX_MARKET_COMPLEX_EXPOSURE_RATIO = 0.2;
const DEFAULT_MAX_CONTRACT_EXPOSURE_RATIO = 0.12;
const DEFAULT_MAX_INITIAL_ORDER_SLICE_RATIO = 0.05;
const DEFAULT_MAX_ACTIVE_SLEEVES = 2;

export interface AllocatorConfig {
  env: "sim" | "paper" | "prod";
  bankrollUsd: number;
  maxGrossExposureRatio: number;
  maxSleeveExposureRatio: number;
  maxMarketComplexExposureRatio: number;
  maxContractExposureRatio: number;
  maxInitialOrderSliceRatio: number;
  maxActiveSleeves: number;
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

export function loadAllocatorConfig(): AllocatorConfig {
  const env = (process.env.RUNTIME_MODE ?? "paper") as AllocatorConfig["env"];
  if (!["sim", "paper", "prod"].includes(env)) {
    throw new Error(`Unsupported RUNTIME_MODE "${env}"`);
  }

  return {
    env,
    bankrollUsd: parsePositiveNumber(process.env.BANKROLL_USD, DEFAULT_BANKROLL_USD),
    maxGrossExposureRatio: parsePositiveNumber(
      process.env.MAX_GROSS_EXPOSURE_RATIO,
      DEFAULT_MAX_GROSS_EXPOSURE_RATIO
    ),
    maxSleeveExposureRatio: parsePositiveNumber(
      process.env.MAX_SLEEVE_EXPOSURE_RATIO,
      DEFAULT_MAX_SLEEVE_EXPOSURE_RATIO
    ),
    maxMarketComplexExposureRatio: parsePositiveNumber(
      process.env.MAX_MARKET_COMPLEX_EXPOSURE_RATIO,
      DEFAULT_MAX_MARKET_COMPLEX_EXPOSURE_RATIO
    ),
    maxContractExposureRatio: parsePositiveNumber(
      process.env.MAX_CONTRACT_EXPOSURE_RATIO,
      DEFAULT_MAX_CONTRACT_EXPOSURE_RATIO
    ),
    maxInitialOrderSliceRatio: parsePositiveNumber(
      process.env.MAX_INITIAL_ORDER_SLICE_RATIO,
      DEFAULT_MAX_INITIAL_ORDER_SLICE_RATIO
    ),
    maxActiveSleeves: parsePositiveInt(process.env.MAX_ACTIVE_SLEEVES, DEFAULT_MAX_ACTIVE_SLEEVES)
  };
}
