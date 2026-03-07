export interface ControlConfig {
  env: "sim" | "paper" | "prod";
  currentStateTableName: string;
  decisionLedgerTableName: string;
  defaultMode: "sim" | "paper" | "prod";
}

export function loadControlConfig(): ControlConfig {
  const env = (process.env.RUNTIME_MODE ?? "paper") as ControlConfig["env"];
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
    defaultMode: env
  };
}
