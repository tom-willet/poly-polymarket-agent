import process from "node:process";
import { loadSlackRuntimeConfig } from "./config.js";
import { startSlackRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const [, , command] = process.argv;
  if ((command ?? "socket") !== "socket") {
    throw new Error(`Unsupported command "${command}"`);
  }

  await startSlackRuntime(loadSlackRuntimeConfig());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
