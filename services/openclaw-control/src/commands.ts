import type {
  EventEnvelope,
  OperatorCommandPayload,
  OperatorNotificationPayload,
  OperatorStatePayload
} from "./contracts.js";
import type {
  AccountHealthPayload,
  CurrentStateStore,
  DecisionLedgerStore,
  MarketHealthPayload
} from "./store.js";
import { loadOperatorState } from "./store.js";

export interface CommandContext {
  env: "sim" | "paper" | "prod";
  defaultMode: "sim" | "paper" | "prod";
  currentState: CurrentStateStore;
  decisionLedger: DecisionLedgerStore;
}

function envelope(
  env: CommandContext["env"],
  payload: OperatorNotificationPayload
): EventEnvelope<OperatorNotificationPayload> {
  return {
    schema_version: "v1",
    env,
    event_type: "operator_notification",
    service: "openclaw-control",
    trace_id: crypto.randomUUID(),
    ts_utc: new Date().toISOString(),
    payload
  };
}

async function writeOperatorState(
  context: CommandContext,
  nextState: OperatorStatePayload,
  command: OperatorCommandPayload["command"],
  commandId: string
): Promise<void> {
  const now = new Date().toISOString();
  await context.currentState.put("control#operator", "latest", {
    schema_version: "v1",
    env: context.env,
    event_type: "operator_state",
    service: "openclaw-control",
    trace_id: crypto.randomUUID(),
    ts_utc: now,
    payload: nextState
  });

  await context.decisionLedger.put("operator#commands", `${now}#${commandId}`, {
    schema_version: "v1",
    env: context.env,
    event_type: "operator_command",
    service: "openclaw-control",
    trace_id: crypto.randomUUID(),
    ts_utc: now,
    payload: {
      command_id: commandId,
      command,
      operator_state: nextState
    }
  });
}

async function marketHealthSummary(context: CommandContext): Promise<string[]> {
  const health = await context.currentState.get<MarketHealthPayload>("health#market-data", "latest");
  if (!health) {
    return ["market data: missing"];
  }

  return [
    `market data: ${health.payload.stale ? "STALE" : "fresh"}`,
    `observed/tracked contracts: ${health.payload.observed_contracts}/${health.payload.tracked_contracts}`,
    `last market message: ${health.payload.last_message_ts_utc}`
  ];
}

async function accountHealthSummary(context: CommandContext): Promise<string[]> {
  const accounts = await context.currentState.queryByPkPrefix("account#");
  const healthRows = accounts.filter((item) => item.sk === "health");
  if (healthRows.length === 0) {
    return ["account state: missing"];
  }

  const mapped = healthRows.map((row) => row.payload as AccountHealthPayload);
  const staleCount = mapped.filter((row) => row.stale).length;
  const badRecon = mapped.filter((row) => !row.reconciliation_ok).length;
  return [
    `tracked accounts: ${healthRows.length}`,
    `stale accounts: ${staleCount}`,
    `reconciliation failures: ${badRecon}`
  ];
}

async function sleevesSummary(context: CommandContext): Promise<string[]> {
  const entries = await context.decisionLedger.query("operator#commands", 10);
  const recentCommands = entries.map((entry) => entry.payload as { command: string });
  return [
    "enabled sleeves: cross_market_core",
    `recent operator commands: ${recentCommands.map((entry) => entry.command).join(", ") || "none"}`
  ];
}

async function whySummary(context: CommandContext): Promise<string[]> {
  const recent = await context.decisionLedger.query("operator#commands", 5);
  if (recent.length === 0) {
    return ["no operator decision history yet"];
  }

  return recent.map((entry) => {
    const payload = entry.payload as { command: string; operator_state?: OperatorStatePayload };
    const state = payload.operator_state;
    return state
      ? `${entry.ts_utc}: ${payload.command} -> mode=${state.mode}, paused=${state.paused}, flatten=${state.flatten_requested}`
      : `${entry.ts_utc}: ${payload.command}`;
  });
}

export async function handleOperatorCommand(
  command: OperatorCommandPayload,
  context: CommandContext
): Promise<EventEnvelope<OperatorNotificationPayload>> {
  const operatorState = await loadOperatorState(context.currentState, context.defaultMode);

  if (command.command === "pause") {
    const nextState = {
      ...operatorState,
      paused: true,
      updated_by: command.user_id,
      updated_at_utc: new Date().toISOString()
    };
    await writeOperatorState(context, nextState, command.command, command.command_id);
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: `System paused in ${nextState.mode} mode.`,
      details: ["new execution requests must halt until resume"]
    });
  }

  if (command.command === "resume") {
    const nextState = {
      ...operatorState,
      paused: false,
      flatten_requested: false,
      updated_by: command.user_id,
      updated_at_utc: new Date().toISOString()
    };
    await writeOperatorState(context, nextState, command.command, command.command_id);
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: `System resumed in ${nextState.mode} mode.`,
      details: ["new execution may continue if downstream health checks stay green"]
    });
  }

  if (command.command === "flatten") {
    const nextState = {
      ...operatorState,
      paused: true,
      flatten_requested: true,
      updated_by: command.user_id,
      updated_at_utc: new Date().toISOString()
    };
    await writeOperatorState(context, nextState, command.command, command.command_id);
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: "Flatten requested. New execution must stop immediately.",
      details: ["existing open orders should be canceled by downstream execution workers"]
    });
  }

  if (command.command === "mode") {
    const requested = command.args?.[0];
    if (!requested || !["sim", "paper", "prod"].includes(requested)) {
      return envelope(context.env, {
        command_id: command.command_id,
        command: command.command,
        summary: `Current mode is ${operatorState.mode}.`,
        details: ["supply one of: sim, paper, prod"]
      });
    }
    const nextState = {
      ...operatorState,
      mode: requested as OperatorStatePayload["mode"],
      updated_by: command.user_id,
      updated_at_utc: new Date().toISOString()
    };
    await writeOperatorState(context, nextState, command.command, command.command_id);
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: `Mode set to ${nextState.mode}.`,
      details: [`paused=${nextState.paused}`, `flatten_requested=${nextState.flatten_requested}`]
    });
  }

  if (command.command === "status") {
    const details = [
      `operator mode: ${operatorState.mode}`,
      `paused: ${operatorState.paused}`,
      `flatten requested: ${operatorState.flatten_requested}`,
      ...(await marketHealthSummary(context)),
      ...(await accountHealthSummary(context))
    ];
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: "Operator status snapshot",
      details
    });
  }

  if (command.command === "risk") {
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: "Current v1 risk posture",
      details: [
        `mode=${operatorState.mode}`,
        `paused=${operatorState.paused}`,
        "max gross exposure=70% bankroll",
        "max sleeve exposure=35% bankroll",
        "max market complex exposure=20% bankroll",
        "max contract exposure=12% bankroll",
        "daily stop=7.5%, weekly drawdown=15%"
      ]
    });
  }

  if (command.command === "sleeves") {
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: "Sleeve status snapshot",
      details: await sleevesSummary(context)
    });
  }

  if (command.command === "why") {
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: "Recent operator-control decisions",
      details: await whySummary(context)
    });
  }

  return envelope(context.env, {
    command_id: command.command_id,
    command: command.command,
    summary: "Command not yet implemented",
    details: []
  });
}
