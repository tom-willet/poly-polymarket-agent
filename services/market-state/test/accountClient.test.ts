import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCollateral } from "../src/polymarket/accountClient.js";

test("normalizeCollateral preserves singular allowance responses", () => {
  const collateral = normalizeCollateral({
    balance: "12.5",
    allowance: "7.25"
  });

  assert.deepEqual(collateral, {
    asset_type: "COLLATERAL",
    token_id: null,
    balance: 12.5,
    allowance: 7.25
  });
});

test("normalizeCollateral falls back to plural allowances responses", () => {
  const collateral = normalizeCollateral({
    balance: "0",
    allowances: {
      "0x111": "0",
      "0x222": "15.5",
      "0x333": "3.25"
    }
  });

  assert.deepEqual(collateral, {
    asset_type: "COLLATERAL",
    token_id: null,
    balance: 0,
    allowance: 15.5
  });
});
