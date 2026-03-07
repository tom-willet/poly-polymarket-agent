import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGammaMarket } from "../src/polymarket/normalize.js";
import type { GammaMarket } from "../src/polymarket/gammaTypes.js";

test("normalizeGammaMarket creates stable contract and market records", () => {
  const market: GammaMarket = {
    id: "531202",
    question: "BitBoy convicted?",
    slug: "bitboy-convicted",
    active: true,
    closed: false,
    archived: false,
    acceptingOrders: true,
    enableOrderBook: true,
    approved: true,
    restricted: true,
    outcomes: "[\"Yes\", \"No\"]",
    outcomePrices: "[\"0.1425\", \"0.8575\"]",
    clobTokenIds: "[\"yes-token\", \"no-token\"]",
    liquidityNum: 2674.99359,
    volume24hr: 5146.766464,
    volumeNum: 58365.48137899987,
    spread: 0.005,
    bestBid: 0.14,
    bestAsk: 0.145,
    orderPriceMinTickSize: 0.001,
    orderMinSize: 5,
    endDate: "2026-03-31T12:00:00Z",
    tags: [{ slug: "crypto" }, { label: "courts" }],
    events: [{ id: "21662", slug: "bitboy-convicted", title: "BitBoy convicted?" }]
  };

  const normalized = normalizeGammaMarket(market);

  assert.equal(normalized.market_id, "531202");
  assert.equal(normalized.event_id, "21662");
  assert.equal(normalized.market_complex_id, "event:21662");
  assert.equal(normalized.spread_cents, 0.5);
  assert.deepEqual(normalized.tags, ["crypto", "courts"]);
  assert.equal(normalized.contracts.length, 2);
  assert.deepEqual(normalized.contracts[0], {
    contract_id: "yes-token",
    outcome: "Yes",
    token_id: "yes-token",
    last_trade_price: 0.1425,
    best_bid: 0.14,
    best_ask: 0.145
  });
  assert.deepEqual(normalized.contracts[1], {
    contract_id: "no-token",
    outcome: "No",
    token_id: "no-token",
    last_trade_price: 0.8575,
    best_bid: null,
    best_ask: null
  });
});
