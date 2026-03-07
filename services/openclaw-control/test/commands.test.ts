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
