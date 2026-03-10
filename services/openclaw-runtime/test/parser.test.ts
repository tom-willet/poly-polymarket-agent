import test from "node:test";
import assert from "node:assert/strict";
import { parseSlackCommand } from "../src/parser.js";

test("parseSlackCommand recognizes operator commands", () => {
  assert.deepEqual(parseSlackCommand("<@U123> status check"), {
    kind: "operator",
    command: "status",
    args: []
  });
  assert.deepEqual(parseSlackCommand("paper"), {
    kind: "operator",
    command: "paper",
    args: []
  });
  assert.deepEqual(parseSlackCommand("markets"), {
    kind: "operator",
    command: "markets",
    args: []
  });
  assert.deepEqual(parseSlackCommand("orders"), {
    kind: "operator",
    command: "orders",
    args: []
  });
  assert.deepEqual(parseSlackCommand("fills"), {
    kind: "operator",
    command: "fills",
    args: []
  });
  assert.deepEqual(parseSlackCommand("pnl"), {
    kind: "operator",
    command: "pnl",
    args: []
  });
  assert.deepEqual(parseSlackCommand("scorecard"), {
    kind: "operator",
    command: "scorecard",
    args: []
  });
  assert.deepEqual(parseSlackCommand("daily"), {
    kind: "operator",
    command: "scorecard",
    args: []
  });
  assert.deepEqual(parseSlackCommand("mode prod"), {
    kind: "operator",
    command: "mode",
    args: ["prod"]
  });
});

test("parseSlackCommand recognizes propose and cycle", () => {
  assert.deepEqual(parseSlackCommand("propose"), { kind: "propose" });
  assert.deepEqual(parseSlackCommand("run cycle"), { kind: "cycle" });
});

test("parseSlackCommand falls back to help", () => {
  assert.deepEqual(parseSlackCommand("what is happening"), { kind: "help" });
});
