export interface ControlConfig {
  env: "sim" | "paper" | "prod";
  currentStateTableName: string;
  decisionLedgerTableName: string;
  defaultMode: "sim" | "paper" | "prod";
  proposalMinEdgeCents: number;
  proposalMaxSpreadCents: number;
  proposalCostPerLegCents: number;
  proposalDefaultHoldingHours: number;
  proposalSizingHintUsd: number;
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
    defaultMode: env,
    proposalMinEdgeCents: parsePositiveNumber(process.env.PROPOSAL_MIN_EDGE_CENTS, 3),
    proposalMaxSpreadCents: parsePositiveNumber(process.env.PROPOSAL_MAX_SPREAD_CENTS, 4),
    proposalCostPerLegCents: parsePositiveNumber(process.env.PROPOSAL_COST_PER_LEG_CENTS, 1),
    proposalDefaultHoldingHours: parsePositiveNumber(process.env.PROPOSAL_DEFAULT_HOLDING_HOURS, 24),
    proposalSizingHintUsd: parsePositiveNumber(process.env.PROPOSAL_SIZING_HINT_USD, 40)
  };
}
