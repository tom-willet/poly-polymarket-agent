import process from "node:process";
import {
  DynamoDbCurrentStateStore,
  DynamoDbDecisionLedgerStore
} from "@poly/openclaw-control";
import { loadExecutionWorkerConfig } from "./config.js";
import { runExecutionTick } from "./worker.js";

function parseArgs(argv: string[]): { command: string } {
  const [, , command] = argv;
  return {
    command: command ?? "tick"
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  const { command } = parseArgs(process.argv);
  if (!["tick", "loop"].includes(command)) {
    throw new Error(`Unsupported command "${command}"`);
  }

  const config = loadExecutionWorkerConfig();
  const currentState = new DynamoDbCurrentStateStore(config.currentStateTableName);
  const decisionLedger = new DynamoDbDecisionLedgerStore(config.decisionLedgerTableName);

  if (command === "tick") {
    const summary = await runExecutionTick(config, currentState, decisionLedger);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  while (true) {
    const summary = await runExecutionTick(config, currentState, decisionLedger);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    await sleep(config.pollIntervalMs);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
