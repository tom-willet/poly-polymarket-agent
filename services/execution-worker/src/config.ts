export interface ExecutionWorkerConfig {
  env: "sim" | "paper" | "prod";
  currentStateTableName: string;
  decisionLedgerTableName: string;
  pollIntervalMs: number;
  maxIntentsPerTick: number;
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

export function loadExecutionWorkerConfig(): ExecutionWorkerConfig {
  const env = (process.env.RUNTIME_MODE ?? "paper") as ExecutionWorkerConfig["env"];
  if (!["sim", "paper", "prod"].includes(env)) {
    throw new Error(`Unsupported RUNTIME_MODE "${env}"`);
  }

  const currentStateTableName = process.env.STATE_CURRENT_TABLE;
  const decisionLedgerTableName = process.env.DECISION_LEDGER_TABLE;

  if (!currentStateTableName) {
    throw new Error("STATE_CURRENT_TABLE is required");
  }

  if (!decisionLedgerTableName) {
    throw new Error("DECISION_LEDGER_TABLE is required");
  }

  return {
    env,
    currentStateTableName,
    decisionLedgerTableName,
    pollIntervalMs: parsePositiveInt(process.env.EXECUTION_WORKER_POLL_INTERVAL_MS, 5_000),
    maxIntentsPerTick: parsePositiveInt(process.env.EXECUTION_WORKER_MAX_INTENTS, 25)
  };
}
