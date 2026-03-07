import test from "node:test";
import assert from "node:assert/strict";
import { toPositionSnapshotEnvelopes, type AccountStateSnapshotPayload } from "../src/accountSnapshot.js";

test("toPositionSnapshotEnvelopes derives stable position exposure records", () => {
  const tsMs = Date.parse("2026-03-07T04:00:00Z");
  const accountSnapshot: AccountStateSnapshotPayload = {
    user_address: "0xuser",
    funder_address: "0xfunder",
    collateral: {
      asset_type: "COLLATERAL",
      token_id: null,
      balance: 100,
      allowance: 100
    },
    open_order_count: 0,
    position_count: 1,
    recent_trade_count: 0,
    total_position_value_usd: 8.25,
    open_orders: [],
    positions: [
      {
        market_id: "market-1",
        contract_id: "contract-1",
        condition_id: "condition-1",
        outcome: "YES",
        size: 10,
        avg_price: 0.6,
        current_price: 0.825,
        current_value_usd: 8.25,
        cash_pnl_usd: 1.5,
        redeemable: false,
        title: "Example market",
        slug: "example-market",
        event_slug: "example-event",
        end_date_utc: "2026-03-08T04:00:00Z"
      }
    ],
    recent_trades: []
  };

  const [positionSnapshot] = toPositionSnapshotEnvelopes("paper", accountSnapshot, tsMs);

  assert.ok(positionSnapshot);
  assert.equal(positionSnapshot.payload.wallet_id, "0xfunder");
  assert.equal(positionSnapshot.payload.sleeve_id, "cross_market_core");
  assert.equal(positionSnapshot.payload.market_complex_id, "event:example-event");
  assert.equal(positionSnapshot.payload.gross_exposure_usd, 8.25);
  assert.equal(positionSnapshot.payload.net_exposure_usd, 8.25);
  assert.equal(positionSnapshot.payload.realized_pnl_usd, 1.5);
  assert.equal(positionSnapshot.payload.unrealized_pnl_usd, 2.25);
  assert.equal(positionSnapshot.payload.open_orders_reserved_usd, 0);
  assert.equal(positionSnapshot.payload.snapshot_ts_utc, "2026-03-07T04:00:00.000Z");
});
