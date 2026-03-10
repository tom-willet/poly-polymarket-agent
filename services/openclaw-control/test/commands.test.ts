import test from "node:test";
import assert from "node:assert/strict";
import { handleOperatorCommand } from "../src/commands.js";
import type { CurrentStateStore, DecisionLedgerStore } from "../src/store.js";

class InMemoryCurrentStateStore implements CurrentStateStore {
  constructor(private readonly items = new Map<string, Record<string, unknown>>()) {}

  async get<T>(pk: string, sk: string): Promise<{ payload: T; ts_utc: string; event_type: string } | null> {
    return (this.items.get(`${pk}|${sk}`) as { payload: T; ts_utc: string; event_type: string } | undefined) ?? null;
  }

  async queryByPkPrefix(prefix: string): Promise<Array<{ pk: string; sk: string; payload: unknown; ts_utc: string }>> {
    return [...this.items.entries()]
      .filter(([key]) => key.startsWith(`${prefix}`))
      .map(([key, value]) => {
        const [pk, sk] = key.split("|");
        return {
          pk: pk!,
          sk: sk!,
          payload: value.payload,
          ts_utc: String(value.ts_utc ?? new Date().toISOString())
        };
      });
  }

  async put(pk: string, sk: string, item: Record<string, unknown>): Promise<void> {
    this.items.set(`${pk}|${sk}`, item);
  }
}

class InMemoryDecisionLedgerStore implements DecisionLedgerStore {
  readonly items: Array<{ pk: string; sk: string; payload: unknown; ts_utc: string; event_type: string }> = [];

  async put(pk: string, sk: string, item: Record<string, unknown>): Promise<void> {
    this.items.push({
      pk,
      sk,
      payload: item.payload,
      ts_utc: String(item.ts_utc ?? new Date().toISOString()),
      event_type: String(item.event_type ?? "unknown")
    });
  }

  async query(
    pk: string,
    limit = 5
  ): Promise<Array<{ pk: string; sk: string; payload: unknown; ts_utc: string; event_type: string }>> {
    return this.items.filter((item) => item.pk === pk).slice(-limit).reverse();
  }
}

function baseContext() {
  const currentState = new InMemoryCurrentStateStore(
    new Map([
      [
        "health#market-data|latest",
        {
          ts_utc: "2026-03-07T04:00:00Z",
          event_type: "market_data_health",
          payload: {
            stale: false,
            tracked_contracts: 2,
            observed_contracts: 2,
            last_message_ts_utc: "2026-03-07T04:00:00Z"
          }
        }
      ],
      [
        "account#0xabc|health",
        {
          ts_utc: "2026-03-07T04:00:00Z",
          event_type: "account_state_health",
          payload: {
            stale: false,
            reconciliation_ok: true,
            open_order_count: 0,
            position_count: 0,
            recent_trade_count: 0
          }
        }
      ]
    ])
  );

  return {
    env: "paper" as const,
    defaultMode: "paper" as const,
    currentState,
    decisionLedger: new InMemoryDecisionLedgerStore()
  };
}

async function seedPaperState(context: ReturnType<typeof baseContext>): Promise<void> {
  await context.currentState.put("paper_cash#paper:0xabc", "latest", {
    ts_utc: "2026-03-10T00:00:00Z",
    event_type: "paper_cash_snapshot",
    payload: {
      wallet_id: "paper:0xabc",
      starting_cash_usd: 500,
      cash_balance_usd: 460,
      reserved_cash_usd: 20,
      available_cash_usd: 440,
      realized_pnl_usd: 5,
      updated_at_utc: "2026-03-10T00:00:00Z"
    }
  });
  await context.currentState.put("position#paper:0xabc#event:1", "snapshot", {
    ts_utc: "2026-03-10T00:00:00Z",
    event_type: "position_snapshot",
    payload: {
      wallet_id: "paper:0xabc",
      sleeve_id: "cross_market_core",
      market_complex_id: "event:1",
      gross_exposure_usd: 40,
      net_exposure_usd: 40,
      realized_pnl_usd: 5,
      unrealized_pnl_usd: 2,
      open_orders_reserved_usd: 20,
      snapshot_ts_utc: "2026-03-10T00:00:00Z"
    }
  });
  await context.currentState.put("paper_order#order-open", "latest", {
    ts_utc: "2026-03-10T00:05:00Z",
    event_type: "paper_order",
    payload: {
      paper_order_id: "order-open",
      wallet_id: "paper:0xabc",
      order_plan_id: "plan-1",
      decision_id: "decision-1",
      sleeve_id: "cross_market_core",
      market_complex_id: "event:1",
      market_id: "market-1",
      contract_id: "ct_yes",
      side: "buy",
      order_style: "passive",
      status: "open",
      limit_price: 0.41,
      requested_size: 10,
      filled_size: 0,
      remaining_size: 10,
      avg_fill_price: null,
      created_at_utc: "2026-03-10T00:05:00Z",
      updated_at_utc: "2026-03-10T00:05:00Z"
    }
  });
  await context.currentState.put("paper_order#order-cancelled", "latest", {
    ts_utc: "2026-03-10T00:04:00Z",
    event_type: "paper_order",
    payload: {
      paper_order_id: "order-cancelled",
      wallet_id: "paper:0xabc",
      order_plan_id: "plan-2",
      decision_id: "decision-2",
      sleeve_id: "cross_market_core",
      market_complex_id: "event:2",
      market_id: "market-2",
      contract_id: "ct_no",
      side: "sell",
      order_style: "passive",
      status: "cancelled",
      limit_price: 0.62,
      requested_size: 8,
      filled_size: 0,
      remaining_size: 0,
      avg_fill_price: null,
      created_at_utc: "2026-03-10T00:04:00Z",
      updated_at_utc: "2026-03-10T00:04:00Z"
    }
  });
  await context.currentState.put("paper_fill#fill-1", "latest", {
    ts_utc: "2026-03-10T00:06:00Z",
    event_type: "paper_fill",
    payload: {
      paper_fill_id: "fill-1",
      paper_order_id: "order-filled-1",
      wallet_id: "paper:0xabc",
      order_plan_id: "plan-3",
      decision_id: "decision-3",
      sleeve_id: "cross_market_core",
      market_complex_id: "event:1",
      market_id: "market-1",
      contract_id: "ct_yes",
      side: "buy",
      liquidity: "cross",
      fill_price: 0.41,
      fill_size: 10,
      fill_notional_usd: 4.1,
      fill_ts_utc: "2026-03-10T00:06:00Z"
    }
  });
}

test("status reports operator and state health summary", async () => {
  const response = await handleOperatorCommand(
    {
      command_id: "cmd-1",
      user_id: "u-1",
      channel_id: "c-1",
      command: "status"
    },
    baseContext()
  );

  assert.equal(response.payload.summary, "Operator status snapshot");
  assert.match(response.payload.details.join("\n"), /market data: fresh/);
  assert.match(response.payload.details.join("\n"), /tracked accounts: 1/);
  assert.match(response.payload.details.join("\n"), /paper portfolio: not initialized/);
});

test("status reports paper cash and exposure when paper portfolio exists", async () => {
  const context = baseContext();
  await seedPaperState(context);

  const response = await handleOperatorCommand(
    {
      command_id: "cmd-1b",
      user_id: "u-1",
      channel_id: "c-1",
      command: "status"
    },
    context
  );

  assert.match(response.payload.details.join("\n"), /paper cash: \$460\.00/);
  assert.match(response.payload.details.join("\n"), /paper gross exposure: \$40\.00/);
  assert.match(response.payload.details.join("\n"), /paper pnl: realized=\$5\.00, unrealized=\$2\.00/);
});

test("paper reports high-level paper portfolio view", async () => {
  const context = baseContext();
  await seedPaperState(context);

  const response = await handleOperatorCommand(
    {
      command_id: "cmd-paper",
      user_id: "u-1",
      channel_id: "c-1",
      command: "paper"
    },
    context
  );

  assert.equal(response.payload.summary, "Current paper portfolio");
  assert.match(response.payload.details.join("\n"), /paper wallet: paper:0xabc/);
  assert.match(response.payload.details.join("\n"), /open paper orders: 1/);
  assert.match(response.payload.details.join("\n"), /paper fills recorded: 1/);
});

test("orders only reports open paper orders", async () => {
  const context = baseContext();
  await seedPaperState(context);

  const response = await handleOperatorCommand(
    {
      command_id: "cmd-orders",
      user_id: "u-1",
      channel_id: "c-1",
      command: "orders"
    },
    context
  );

  assert.equal(response.payload.summary, "Open paper orders");
  assert.match(response.payload.details.join("\n"), /event:1 ct_yes buy passive remaining=10\.0000 @ 0\.4100/);
  assert.doesNotMatch(response.payload.details.join("\n"), /event:2/);
});

test("fills reports recent paper fills", async () => {
  const context = baseContext();
  await seedPaperState(context);

  const response = await handleOperatorCommand(
    {
      command_id: "cmd-fills",
      user_id: "u-1",
      channel_id: "c-1",
      command: "fills"
    },
    context
  );

  assert.equal(response.payload.summary, "Recent paper fills");
  assert.match(
    response.payload.details.join("\n"),
    /2026-03-10T00:06:00Z event:1 ct_yes buy cross 10\.0000 @ 0\.4100 notional=\$4\.10/
  );
});

test("pnl reports total and per-position paper pnl", async () => {
  const context = baseContext();
  await seedPaperState(context);

  const response = await handleOperatorCommand(
    {
      command_id: "cmd-pnl",
      user_id: "u-1",
      channel_id: "c-1",
      command: "pnl"
    },
    context
  );

  assert.equal(response.payload.summary, "Paper PnL snapshot");
  assert.match(response.payload.details.join("\n"), /paper cash: \$460\.00/);
  assert.match(
    response.payload.details.join("\n"),
    /event:1 gross=\$40\.00 net=\$40\.00 realized=\$5\.00 unrealized=\$2\.00/
  );
});

test("pause persists operator state and logs to ledger", async () => {
  const context = baseContext();
  const response = await handleOperatorCommand(
    {
      command_id: "cmd-2",
      user_id: "u-2",
      channel_id: "c-1",
      command: "pause"
    },
    context
  );

  assert.match(response.payload.summary, /System paused/);
  const stored = await context.currentState.get<{ paused: boolean }>("control#operator", "latest");
  assert.equal(stored?.payload.paused, true);
  assert.equal(context.decisionLedger.items.length, 1);
});

test("mode updates persisted operator mode", async () => {
  const context = baseContext();
  const response = await handleOperatorCommand(
    {
      command_id: "cmd-3",
      user_id: "u-3",
      channel_id: "c-1",
      command: "mode",
      args: ["sim"]
    },
    context
  );

  assert.match(response.payload.summary, /Mode set to sim/);
  const stored = await context.currentState.get<{ mode: string }>("control#operator", "latest");
  assert.equal(stored?.payload.mode, "sim");
});
