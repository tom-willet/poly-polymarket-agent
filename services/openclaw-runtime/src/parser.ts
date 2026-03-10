import type { OperatorCommandPayload } from "@poly/openclaw-control";

export type ParsedSlackCommand =
  | { kind: "operator"; command: OperatorCommandPayload["command"]; args: string[] }
  | { kind: "cycle" }
  | { kind: "propose" }
  | { kind: "help" };

function normalizeText(text: string): string[] {
  return text
    .replace(/<@[^>]+>/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function parseSlackCommand(text: string): ParsedSlackCommand {
  const tokens = normalizeText(text);
  if (tokens.length === 0) {
    return { kind: "help" };
  }

  const [first, second, ...rest] = tokens;
  if (!first) {
    return { kind: "help" };
  }

  if (first === "cycle" || (first === "run" && second === "cycle")) {
    return { kind: "cycle" };
  }

  if (first === "propose" || first === "scan") {
    return { kind: "propose" };
  }

  if (first === "status" || (first === "status" && second === "check")) {
    return { kind: "operator", command: "status", args: [] };
  }

  if (
    first === "paper" ||
    first === "markets" ||
    first === "orders" ||
    first === "fills" ||
    first === "pnl" ||
    first === "scorecard" ||
    first === "why" ||
    first === "risk" ||
    first === "pause" ||
    first === "resume" ||
    first === "flatten" ||
    first === "mode" ||
    first === "sleeves"
  ) {
    return {
      kind: "operator",
      command: first,
      args: first === "mode" ? [second, ...rest].filter(Boolean) : []
    } as { kind: "operator"; command: OperatorCommandPayload["command"]; args: string[] };
  }

  if (first === "daily") {
    return {
      kind: "operator",
      command: "scorecard",
      args: []
    };
  }

  return { kind: "help" };
}
