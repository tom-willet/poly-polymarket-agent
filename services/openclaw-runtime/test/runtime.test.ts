import test from "node:test";
import assert from "node:assert/strict";
import { handleSlackText } from "../src/runtime.js";
import type { CurrentStateStore, DecisionLedgerStore } from "@poly/openclaw-control";

class InMemoryCurrentStateStore implements CurrentStateStore {
  constructor(private readonly items = new Map<string, Record<string, unknown>>()) {}

  async get<T>(pk: string, sk: string): Promise<{ payload: T; ts_utc: string; event_type: string } | null> {
    return (this.items.get(`${pk}|${sk}`) as { payload: T; ts_utc: string; event_type: string } | undefined) ?? null;
  }

  async queryByPkPrefix(prefix: string): Promise<Array<{ pk: string; sk: string; payload: unknown; ts_utc: string }>> {
    return [...this.items.entries()]
      .filter(([key]) => key.startsWith(prefix))
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
    this.items.set(`${pk}|${sk}`, { ...item });
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

function baseState(): InMemoryCurrentStateStore {
  return new InMemoryCurrentStateStore(
    new Map([
      [
        "health#market-data|latest",
        {
          ts_utc: "2026-03-08T00:00:00Z",
          event_type: "market_data_health",
          payload: {
            stale: false,
            tracked_contracts: 2,
            observed_contracts: 2,
            last_message_ts_utc: "2026-03-08T00:00:00Z"
          }
        }
      ],
      [
        "account#0xabc|snapshot",
        {
          ts_utc: "2026-03-08T00:00:00Z",
          event_type: "account_state_snapshot",
          payload: {
            user_address: "0xabc",
            funder_address: "0xabc",
            collateral: {
              balance: 500,
              allowance: 500
            },
            open_order_count: 0,
            position_count: 0,
            recent_trade_count: 0,
            total_position_value_usd: 0
          }
        }
      ],
      [
        "account#0xabc|health",
        {
          ts_utc: "2026-03-08T00:00:00Z",
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
}

test("handleSlackText routes status into operator command core", async () => {
  process.env.RUNTIME_MODE = "paper";
  process.env.STATE_CURRENT_TABLE = "unused";
  process.env.DECISION_LEDGER_TABLE = "unused";
  const response = await handleSlackText(
    "status",
    { userId: "U1", channelId: "C1" },
    {
      env: "paper",
      slackBotToken: "xoxb-test",
      slackAppToken: "xapp-test",
      slackAllowedUserIds: [],
      currentStateTableName: "unused",
      decisionLedgerTableName: "unused"
    },
    {
      currentState: baseState(),
      decisionLedger: new InMemoryDecisionLedgerStore()
    }
  );

  assert.match(response, /Operator status snapshot/);
  assert.match(response, /operator mode: paper/);
});

test("handleSlackText rejects disallowed users", async () => {
  process.env.RUNTIME_MODE = "paper";
  process.env.STATE_CURRENT_TABLE = "unused";
  process.env.DECISION_LEDGER_TABLE = "unused";
  const response = await handleSlackText(
    "status",
    { userId: "U2", channelId: "C1" },
    {
      env: "paper",
      slackBotToken: "xoxb-test",
      slackAppToken: "xapp-test",
      slackAllowedUserIds: ["U1"],
      currentStateTableName: "unused",
      decisionLedgerTableName: "unused"
    },
    {
      currentState: baseState(),
      decisionLedger: new InMemoryDecisionLedgerStore()
    }
  );

  assert.equal(response, "User is not allowed to run operator commands.");
});
