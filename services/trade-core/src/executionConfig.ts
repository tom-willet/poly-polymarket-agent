const DEFAULT_INTENT_EXPIRY_SECONDS = 30;
const DEFAULT_HEARTBEAT_SEND_INTERVAL_MS = 5_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 15_000;
const DEFAULT_PASSIVE_RESTING_MS = 3_000;

export interface ExecutionConfig {
  intentExpirySeconds: number;
  heartbeatSendIntervalMs: number;
  heartbeatTimeoutMs: number;
  passiveRestingMs: number;
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

export function loadExecutionConfig(): ExecutionConfig {
  return {
    intentExpirySeconds: parsePositiveInt(process.env.EXECUTION_INTENT_EXPIRY_SECONDS, DEFAULT_INTENT_EXPIRY_SECONDS),
    heartbeatSendIntervalMs: parsePositiveInt(
      process.env.EXECUTION_HEARTBEAT_SEND_INTERVAL_MS,
      DEFAULT_HEARTBEAT_SEND_INTERVAL_MS
    ),
    heartbeatTimeoutMs: parsePositiveInt(
      process.env.EXECUTION_HEARTBEAT_TIMEOUT_MS,
      DEFAULT_HEARTBEAT_TIMEOUT_MS
    ),
    passiveRestingMs: parsePositiveInt(process.env.EXECUTION_PASSIVE_RESTING_MS, DEFAULT_PASSIVE_RESTING_MS)
  };
}
