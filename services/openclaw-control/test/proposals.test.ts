import test from "node:test";
import assert from "node:assert/strict";
import { generateCrossMarketConsistencyProposals } from "../src/proposals.js";
import type { CurrentStateStore } from "../src/store.js";

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

  async put(): Promise<void> {
    throw new Error("not implemented");
  }
}

function baseEntries(): Array<[string, Record<string, unknown>]> {
  return [
    [
      "health#market-data|latest",
      {
        ts_utc: "2026-03-07T04:00:00Z",
        event_type: "market_data_health",
        payload: {
          stale: false
        }
      }
    ],
    [
      "market#ct-yes|snapshot",
      {
        ts_utc: "2026-03-07T04:00:00Z",
        event_type: "market_snapshot",
        payload: {
          market_id: "mkt-1",
          contract_id: "ct-yes",
          market_complex_id: "event:1",
          status: "active",
          mid_price: 0.49,
          best_bid: 0.48,
          best_ask: 0.49,
          spread_cents: 1,
          top_bid_size: 100,
          top_ask_size: 100,
          time_to_resolution_hours: 24,
          book_ts_utc: "2026-03-07T04:00:00Z"
        }
      }
    ],
    [
      "market#ct-no|snapshot",
      {
        ts_utc: "2026-03-07T04:00:00Z",
        event_type: "market_snapshot",
        payload: {
          market_id: "mkt-1",
          contract_id: "ct-no",
          market_complex_id: "event:1",
          status: "active",
          mid_price: 0.48,
          best_bid: 0.47,
          best_ask: 0.48,
          spread_cents: 1,
          top_bid_size: 100,
          top_ask_size: 100,
          time_to_resolution_hours: 24,
          book_ts_utc: "2026-03-07T04:00:00Z"
        }
      }
    ]
  ];
}

function baseStore(overrides?: Array<[string, Record<string, unknown>]>) {
  return new InMemoryCurrentStateStore(new Map(overrides ?? baseEntries()));
}

const baseConfig = {
  env: "paper" as const,
  currentStateTableName: "unused",
  decisionLedgerTableName: "unused",
  defaultMode: "paper" as const,
  proposalMinEdgeCents: 3,
  proposalMaxSpreadCents: 4,
  proposalCostPerLegCents: 1,
  proposalDefaultHoldingHours: 24,
  proposalSizingHintUsd: 40
};

test("proposal generator emits a buy-both complement proposal when asks sum below par after costs", async () => {
  const proposals = await generateCrossMarketConsistencyProposals({
    env: "paper",
    config: baseConfig,
    currentState: baseStore([
        [
          "health#market-data|latest",
          {
            ts_utc: "2026-03-07T04:00:00Z",
            event_type: "market_data_health",
            payload: {
              stale: false
            }
          }
        ],
        [
          "market#ct-yes|snapshot",
          {
            ts_utc: "2026-03-07T04:00:00Z",
            event_type: "market_snapshot",
            payload: {
              market_id: "mkt-1",
              contract_id: "ct-yes",
              market_complex_id: "event:1",
              status: "active",
              mid_price: 0.47,
              best_bid: 0.46,
              best_ask: 0.47,
              spread_cents: 1,
              top_bid_size: 100,
              top_ask_size: 100,
              time_to_resolution_hours: 24,
              book_ts_utc: "2026-03-07T04:00:00Z"
            }
          }
        ],
        [
          "market#ct-no|snapshot",
          {
            ts_utc: "2026-03-07T04:00:00Z",
            event_type: "market_snapshot",
            payload: {
              market_id: "mkt-1",
              contract_id: "ct-no",
              market_complex_id: "event:1",
              status: "active",
              mid_price: 0.48,
              best_bid: 0.47,
              best_ask: 0.48,
              spread_cents: 1,
              top_bid_size: 100,
              top_ask_size: 100,
              time_to_resolution_hours: 24,
              book_ts_utc: "2026-03-07T04:00:00Z"
            }
          }
        ]
      ])
  });

  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.payload.contracts[0]?.side, "buy");
  assert.equal(proposals[0]?.payload.contracts[1]?.side, "buy");
  assert.match(proposals[0]?.payload.thesis ?? "", /asks sum below par/);
});

test("proposal generator emits no proposal when operator is paused", async () => {
  const proposals = await generateCrossMarketConsistencyProposals({
    env: "paper",
    config: baseConfig,
    currentState: baseStore([
        [
          "control#operator|latest",
          {
            ts_utc: "2026-03-07T04:00:00Z",
            event_type: "operator_state",
            payload: {
              mode: "paper",
              paused: true,
              flatten_requested: false,
              updated_by: "u-1",
              updated_at_utc: "2026-03-07T04:00:00Z"
            }
          }
        ],
        ...baseEntries()
      ])
  });

  assert.equal(proposals.length, 0);
});

test("proposal generator emits no proposal when edge does not clear threshold", async () => {
  const proposals = await generateCrossMarketConsistencyProposals({
    env: "paper",
    config: baseConfig,
    currentState: baseStore()
  });

  assert.equal(proposals.length, 0);
});
