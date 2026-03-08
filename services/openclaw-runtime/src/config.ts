export interface SlackRuntimeConfig {
  env: "sim" | "paper" | "prod";
  slackBotToken: string;
  slackAppToken: string;
  slackAllowedUserIds: string[];
  currentStateTableName: string;
  decisionLedgerTableName: string;
}

export function loadSlackRuntimeConfig(): SlackRuntimeConfig {
  const env = (process.env.RUNTIME_MODE ?? "paper") as SlackRuntimeConfig["env"];
  if (!["sim", "paper", "prod"].includes(env)) {
    throw new Error(`Unsupported RUNTIME_MODE "${env}"`);
  }

  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackAppToken = process.env.SLACK_APP_TOKEN;
  const currentStateTableName = process.env.STATE_CURRENT_TABLE;
  const decisionLedgerTableName = process.env.DECISION_LEDGER_TABLE;

  if (!slackBotToken) {
    throw new Error("SLACK_BOT_TOKEN is required");
  }
  if (!slackAppToken) {
    throw new Error("SLACK_APP_TOKEN is required");
  }
  if (!currentStateTableName) {
    throw new Error("STATE_CURRENT_TABLE is required");
  }
  if (!decisionLedgerTableName) {
    throw new Error("DECISION_LEDGER_TABLE is required");
  }

  return {
    env,
    slackBotToken,
    slackAppToken,
    slackAllowedUserIds: (process.env.SLACK_ALLOWED_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    currentStateTableName,
    decisionLedgerTableName
  };
}
