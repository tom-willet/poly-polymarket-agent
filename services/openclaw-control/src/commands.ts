import type {
  DecisionCyclePayload,
  EventEnvelope,
  OperatorCommandPayload,
  OperatorNotificationPayload,
  OperatorStatePayload
} from "./contracts.js";
import type {
  AccountHealthPayload,
  CurrentStateStore,
  DecisionLedgerStore,
  MarketHealthPayload,
  PaperCashSnapshotPayload,
  PaperFillPayload,
  PaperOrderPayload,
  PositionSnapshotPayload
} from "./store.js";
import { loadOperatorState } from "./store.js";

export interface CommandContext {
  env: "sim" | "paper" | "prod";
  defaultMode: "sim" | "paper" | "prod";
  currentState: CurrentStateStore;
  decisionLedger: DecisionLedgerStore;
}

interface PaperViewState {
  walletId: string | null;
  latestCash?: PaperCashSnapshotPayload;
  positionRows: PositionSnapshotPayload[];
  orderRows: PaperOrderPayload[];
  fillRows: PaperFillPayload[];
}

interface DailyScorecardTotals {
  cycleCount: number;
  proposalCount: number;
  intentCount: number;
  fillCount: number;
  fillNotionalUsd: number;
  openedOrderCount: number;
  cancelledOrderCount: number;
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

function formatUsd(value: number): string {
  const rounded = Number(value.toFixed(2));
  return `$${rounded.toFixed(2)}`;
}

function formatPrice(value: number | null): string {
  if (value === null) {
    return "mkt";
  }
  return value.toFixed(4);
}

function formatSize(value: number): string {
  return value.toFixed(4);
}

function cutoffIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function uniqueCount<T>(items: T[], key: (item: T) => string): number {
  return new Set(items.map((item) => key(item))).size;
}

async function loadPaperViewState(context: CommandContext): Promise<PaperViewState> {
  const cashRows = (await context.currentState.queryByPkPrefix("paper_cash#"))
    .filter((item) => item.sk === "latest")
    .sort((left, right) => right.ts_utc.localeCompare(left.ts_utc));

  const latestCash = cashRows[0]?.payload as PaperCashSnapshotPayload | undefined;
  const positionRows = (await context.currentState.queryByPkPrefix("position#paper:"))
    .filter((item) => item.sk === "snapshot")
    .map((item) => item.payload as PositionSnapshotPayload);
  const orderRows = (await context.currentState.queryByPkPrefix("paper_order#"))
    .filter((item) => item.sk === "latest")
    .map((item) => item.payload as PaperOrderPayload);
  const fillRows = (await context.currentState.queryByPkPrefix("paper_fill#"))
    .filter((item) => item.sk === "latest")
    .map((item) => item.payload as PaperFillPayload);

  const walletId =
    latestCash?.wallet_id ??
    [...positionRows]
      .sort((left, right) => right.snapshot_ts_utc.localeCompare(left.snapshot_ts_utc))
      .at(0)?.wallet_id ??
    [...orderRows]
      .sort((left, right) => right.updated_at_utc.localeCompare(left.updated_at_utc))
      .at(0)?.wallet_id ??
    [...fillRows]
      .sort((left, right) => right.fill_ts_utc.localeCompare(left.fill_ts_utc))
      .at(0)?.wallet_id ??
    null;

  return {
    walletId,
    latestCash,
    positionRows: walletId ? positionRows.filter((item) => item.wallet_id === walletId) : positionRows,
    orderRows: walletId ? orderRows.filter((item) => item.wallet_id === walletId) : orderRows,
    fillRows: walletId ? fillRows.filter((item) => item.wallet_id === walletId) : fillRows
  };
}

async function paperPortfolioSummary(context: CommandContext, viewState?: PaperViewState): Promise<string[]> {
  const state = viewState ?? (await loadPaperViewState(context));
  const { latestCash, positionRows } = state;

  if (!latestCash && positionRows.length === 0) {
    return ["paper portfolio: not initialized"];
  }

  const cash = latestCash ?? {
    cash_balance_usd: 0,
    available_cash_usd: 0,
    reserved_cash_usd: 0,
    realized_pnl_usd: 0
  };
  const grossExposureUsd = positionRows.reduce((sum, row) => sum + row.gross_exposure_usd, 0);
  const realizedPnlUsd =
    positionRows.length > 0
      ? positionRows.reduce((sum, row) => sum + row.realized_pnl_usd, 0)
      : cash.realized_pnl_usd;
  const unrealizedPnlUsd = positionRows.reduce((sum, row) => sum + row.unrealized_pnl_usd, 0);

  return [
    `paper cash: ${formatUsd(cash.cash_balance_usd)}`,
    `paper available cash: ${formatUsd(cash.available_cash_usd)}`,
    `paper reserved cash: ${formatUsd(cash.reserved_cash_usd)}`,
    `paper positions tracked: ${positionRows.length}`,
    `paper gross exposure: ${formatUsd(grossExposureUsd)}`,
    `paper pnl: realized=${formatUsd(realizedPnlUsd)}, unrealized=${formatUsd(unrealizedPnlUsd)}`
  ];
}

async function paperViewSummary(context: CommandContext): Promise<string[]> {
  const state = await loadPaperViewState(context);
  const openOrders = state.orderRows.filter((row) => row.status === "open");
  return [
    `paper wallet: ${state.walletId ?? "uninitialized"}`,
    ...(await paperPortfolioSummary(context, state)),
    `open paper orders: ${openOrders.length}`,
    `paper fills recorded: ${state.fillRows.length}`
  ];
}

async function paperOrdersSummary(context: CommandContext): Promise<string[]> {
  const state = await loadPaperViewState(context);
  const openOrders = state.orderRows
    .filter((row) => row.status === "open")
    .sort((left, right) => right.updated_at_utc.localeCompare(left.updated_at_utc));

  if (openOrders.length === 0) {
    return ["no open paper orders"];
  }

  return openOrders.slice(0, 5).map((order) => {
    return `${order.market_complex_id} ${order.contract_id} ${order.side} ${order.order_style} remaining=${formatSize(order.remaining_size)} @ ${formatPrice(order.limit_price)}`;
  });
}

async function paperFillsSummary(context: CommandContext): Promise<string[]> {
  const state = await loadPaperViewState(context);
  const fills = [...state.fillRows].sort((left, right) => right.fill_ts_utc.localeCompare(left.fill_ts_utc));

  if (fills.length === 0) {
    return ["no paper fills recorded"];
  }

  return fills.slice(0, 5).map((fill) => {
    return `${fill.fill_ts_utc} ${fill.market_complex_id} ${fill.contract_id} ${fill.side} ${fill.liquidity} ${formatSize(fill.fill_size)} @ ${formatPrice(fill.fill_price)} notional=${formatUsd(fill.fill_notional_usd)}`;
  });
}

async function paperPnlSummary(context: CommandContext): Promise<string[]> {
  const state = await loadPaperViewState(context);

  if (!state.latestCash && state.positionRows.length === 0) {
    return ["paper portfolio: not initialized"];
  }

  const totals = await paperPortfolioSummary(context, state);
  const positions = [...state.positionRows].sort((left, right) => right.gross_exposure_usd - left.gross_exposure_usd);
  const positionLines =
    positions.length === 0
      ? ["no paper positions open"]
      : positions.slice(0, 5).map((position) => {
          return `${position.market_complex_id} gross=${formatUsd(position.gross_exposure_usd)} net=${formatUsd(position.net_exposure_usd)} realized=${formatUsd(position.realized_pnl_usd)} unrealized=${formatUsd(position.unrealized_pnl_usd)}`;
        });

  return [...totals, ...positionLines];
}

async function dailyPaperScorecard(context: CommandContext): Promise<string[]> {
  const state = await loadPaperViewState(context);
  const cutoff = cutoffIso(24);
  const cycleRows = (await context.decisionLedger.scanByPkPrefix("decision_cycle#"))
    .filter((row) => row.event_type === "decision_cycle" && row.ts_utc >= cutoff)
    .map((row) => row.payload as DecisionCyclePayload);
  const orderRows = (await context.decisionLedger.scanByPkPrefix("paper_order#"))
    .map((row) => row.payload as PaperOrderPayload)
    .filter((row) => !state.walletId || row.wallet_id === state.walletId);
  const fillRows = (await context.decisionLedger.scanByPkPrefix("paper_fill#"))
    .map((row) => row.payload as PaperFillPayload)
    .filter((row) => (!state.walletId || row.wallet_id === state.walletId) && row.fill_ts_utc >= cutoff);

  const openedOrders = orderRows.filter((row) => row.created_at_utc >= cutoff);
  const cancelledOrders = orderRows.filter((row) => row.status === "cancelled" && row.updated_at_utc >= cutoff);
  const totals: DailyScorecardTotals = {
    cycleCount: cycleRows.length,
    proposalCount: cycleRows.reduce((sum, row) => sum + row.proposal_count, 0),
    intentCount: cycleRows.reduce((sum, row) => sum + row.execution_intent_count, 0),
    fillCount: uniqueCount(fillRows, (row) => row.paper_fill_id),
    fillNotionalUsd: fillRows.reduce((sum, row) => sum + row.fill_notional_usd, 0),
    openedOrderCount: uniqueCount(openedOrders, (row) => row.paper_order_id),
    cancelledOrderCount: uniqueCount(cancelledOrders, (row) => row.paper_order_id)
  };
  const pnlLines = await paperPnlSummary(context);

  return [
    `window: last 24h`,
    `paper wallet: ${state.walletId ?? "uninitialized"}`,
    `decision cycles: ${totals.cycleCount}`,
    `proposals generated: ${totals.proposalCount}`,
    `execution intents: ${totals.intentCount}`,
    `paper orders opened: ${totals.openedOrderCount}`,
    `paper orders cancelled: ${totals.cancelledOrderCount}`,
    `paper fills: ${totals.fillCount}`,
    `paper filled notional: ${formatUsd(totals.fillNotionalUsd)}`,
    ...pnlLines
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
      ...(await accountHealthSummary(context)),
      ...(await paperPortfolioSummary(context))
    ];
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: "Operator status snapshot",
      details
    });
  }

  if (command.command === "paper") {
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: "Current paper portfolio",
      details: await paperViewSummary(context)
    });
  }

  if (command.command === "orders") {
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: "Open paper orders",
      details: await paperOrdersSummary(context)
    });
  }

  if (command.command === "fills") {
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: "Recent paper fills",
      details: await paperFillsSummary(context)
    });
  }

  if (command.command === "pnl") {
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: "Paper PnL snapshot",
      details: await paperPnlSummary(context)
    });
  }

  if (command.command === "scorecard") {
    return envelope(context.env, {
      command_id: command.command_id,
      command: command.command,
      summary: "Daily paper scorecard",
      details: await dailyPaperScorecard(context)
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
