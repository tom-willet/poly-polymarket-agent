import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { handleOperatorCommand } from "./commands.js";
import { loadControlConfig } from "./config.js";
import type { OperatorCommandPayload } from "./contracts.js";
import { DynamoDbCurrentStateStore, DynamoDbDecisionLedgerStore } from "./store.js";

function parseArgs(argv: string[]): { command: string; inputPath?: string } {
  const [, , command, ...rest] = argv;
  let inputPath: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--input") {
      inputPath = rest[index + 1];
      index += 1;
    }
  }

  return {
    command: command ?? "handle",
    inputPath
  };
}

async function readCommand(inputPath?: string): Promise<OperatorCommandPayload> {
  if (!inputPath) {
    throw new Error("handle requires --input <path-to-json>");
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const body = await readFile(absolutePath, "utf8");
  return JSON.parse(body) as OperatorCommandPayload;
}

async function main(): Promise<void> {
  const { command, inputPath } = parseArgs(process.argv);
  if (command !== "handle") {
    throw new Error(`Unsupported command "${command}"`);
  }

  const config = loadControlConfig();
  const operatorCommand = await readCommand(inputPath);
  const response = await handleOperatorCommand(operatorCommand, {
    env: config.env,
    defaultMode: config.defaultMode,
    currentState: new DynamoDbCurrentStateStore(config.currentStateTableName),
    decisionLedger: new DynamoDbDecisionLedgerStore(config.decisionLedgerTableName)
  });

  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
