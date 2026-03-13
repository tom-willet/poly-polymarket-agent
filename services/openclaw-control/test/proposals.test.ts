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
      "market#ct-a-yes|snapshot",
      {
        ts_utc: "2026-03-07T04:00:00Z",
        event_type: "market_snapshot",
        payload: {
          market_id: "mkt-a",
          event_id: "event-1",
          slug: "team-a",
          question: "Will Team A win?",
          contract_id: "ct-a-yes",
          outcome: "Yes",
          market_complex_id: "event:1",
          status: "active",
          mid_price: 0.5,
          best_bid: 0.49,
          best_ask: 0.5,
          spread_cents: 1,
          top_bid_size: 100,
          top_ask_size: 100,
          time_to_resolution_hours: 24,
          book_ts_utc: "2026-03-07T04:00:00Z"
        }
      }
    ],
    [
      "market#ct-a-no|snapshot",
      {
        ts_utc: "2026-03-07T04:00:00Z",
        event_type: "market_snapshot",
        payload: {
          market_id: "mkt-a",
          event_id: "event-1",
          slug: "team-a",
          question: "Will Team A win?",
          contract_id: "ct-a-no",
          outcome: "No",
          market_complex_id: "event:1",
          status: "active",
          mid_price: 0.5,
          best_bid: 0.49,
          best_ask: 0.5,
          spread_cents: 1,
          top_bid_size: 100,
          top_ask_size: 100,
          time_to_resolution_hours: 24,
          book_ts_utc: "2026-03-07T04:00:00Z"
        }
      }
    ],
    [
      "market#ct-b-yes|snapshot",
      {
        ts_utc: "2026-03-07T04:00:00Z",
        event_type: "market_snapshot",
        payload: {
          market_id: "mkt-b",
          event_id: "event-1",
          slug: "team-b",
          question: "Will Team B win?",
          contract_id: "ct-b-yes",
          outcome: "Yes",
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
      "market#ct-b-no|snapshot",
      {
        ts_utc: "2026-03-07T04:00:00Z",
        event_type: "market_snapshot",
        payload: {
          market_id: "mkt-b",
          event_id: "event-1",
          slug: "team-b",
          question: "Will Team B win?",
          contract_id: "ct-b-no",
          outcome: "No",
          market_complex_id: "event:1",
          status: "active",
          mid_price: 0.51,
          best_bid: 0.5,
          best_ask: 0.51,
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

test("proposal generator emits a buy-all-yes event basket when related asks sum below par after costs", async () => {
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
          "market#ct-a-yes|snapshot",
          {
            ts_utc: "2026-03-07T04:00:00Z",
            event_type: "market_snapshot",
            payload: {
              market_id: "mkt-a",
              event_id: "event-1",
              slug: "team-a",
              question: "Will Team A win?",
              contract_id: "ct-a-yes",
              outcome: "Yes",
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
          "market#ct-a-no|snapshot",
          {
            ts_utc: "2026-03-07T04:00:00Z",
            event_type: "market_snapshot",
            payload: {
              market_id: "mkt-a",
              event_id: "event-1",
              slug: "team-a",
              question: "Will Team A win?",
              contract_id: "ct-a-no",
              outcome: "No",
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
        ],
        [
          "market#ct-b-yes|snapshot",
          {
            ts_utc: "2026-03-07T04:00:00Z",
            event_type: "market_snapshot",
            payload: {
              market_id: "mkt-b",
              event_id: "event-1",
              slug: "team-b",
              question: "Will Team B win?",
              contract_id: "ct-b-yes",
              outcome: "Yes",
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
        ],
        [
          "market#ct-b-no|snapshot",
          {
            ts_utc: "2026-03-07T04:00:00Z",
            event_type: "market_snapshot",
            payload: {
              market_id: "mkt-b",
              event_id: "event-1",
              slug: "team-b",
              question: "Will Team B win?",
              contract_id: "ct-b-no",
              outcome: "No",
              market_complex_id: "event:1",
              status: "active",
              mid_price: 0.52,
              best_bid: 0.51,
              best_ask: 0.52,
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
  assert.equal(proposals[0]?.payload.contracts.length, 2);
  assert.equal(proposals[0]?.payload.contracts[0]?.side, "buy");
  assert.equal(proposals[0]?.payload.contracts[1]?.side, "buy");
  assert.match(proposals[0]?.payload.thesis ?? "", /YES asks across related markets sum below par/);
  assert.match(proposals[0]?.payload.notes ?? "", /event_legs=2/);
});

test("proposal generator skips non-exclusive qualify baskets even when prices look attractive", async () => {
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
        "market#ct-italy-yes|snapshot",
        {
          ts_utc: "2026-03-07T04:00:00Z",
          event_type: "market_snapshot",
          payload: {
            market_id: "mkt-italy",
            event_id: "event-qualify",
            slug: "italy-qualify",
            question: "Will Italy qualify for the 2026 FIFA World Cup?",
            contract_id: "ct-italy-yes",
            outcome: "Yes",
            market_complex_id: "event:26313",
            status: "active",
            mid_price: 0.31,
            best_bid: 0.3,
            best_ask: 0.31,
            spread_cents: 1,
            top_bid_size: 100,
            top_ask_size: 100,
            time_to_resolution_hours: 24,
            book_ts_utc: "2026-03-07T04:00:00Z"
          }
        }
      ],
      [
        "market#ct-italy-no|snapshot",
        {
          ts_utc: "2026-03-07T04:00:00Z",
          event_type: "market_snapshot",
          payload: {
            market_id: "mkt-italy",
            event_id: "event-qualify",
            slug: "italy-qualify",
            question: "Will Italy qualify for the 2026 FIFA World Cup?",
            contract_id: "ct-italy-no",
            outcome: "No",
            market_complex_id: "event:26313",
            status: "active",
            mid_price: 0.69,
            best_bid: 0.68,
            best_ask: 0.69,
            spread_cents: 1,
            top_bid_size: 100,
            top_ask_size: 100,
            time_to_resolution_hours: 24,
            book_ts_utc: "2026-03-07T04:00:00Z"
          }
        }
      ],
      [
        "market#ct-sweden-yes|snapshot",
        {
          ts_utc: "2026-03-07T04:00:00Z",
          event_type: "market_snapshot",
          payload: {
            market_id: "mkt-sweden",
            event_id: "event-qualify",
            slug: "sweden-qualify",
            question: "Will Sweden qualify for the 2026 FIFA World Cup?",
            contract_id: "ct-sweden-yes",
            outcome: "Yes",
            market_complex_id: "event:26313",
            status: "active",
            mid_price: 0.32,
            best_bid: 0.31,
            best_ask: 0.32,
            spread_cents: 1,
            top_bid_size: 100,
            top_ask_size: 100,
            time_to_resolution_hours: 24,
            book_ts_utc: "2026-03-07T04:00:00Z"
          }
        }
      ],
      [
        "market#ct-sweden-no|snapshot",
        {
          ts_utc: "2026-03-07T04:00:00Z",
          event_type: "market_snapshot",
          payload: {
            market_id: "mkt-sweden",
            event_id: "event-qualify",
            slug: "sweden-qualify",
            question: "Will Sweden qualify for the 2026 FIFA World Cup?",
            contract_id: "ct-sweden-no",
            outcome: "No",
            market_complex_id: "event:26313",
            status: "active",
            mid_price: 0.68,
            best_bid: 0.67,
            best_ask: 0.68,
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

  assert.equal(proposals.length, 0);
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
