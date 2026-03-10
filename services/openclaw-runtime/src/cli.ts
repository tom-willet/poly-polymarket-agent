import process from "node:process";
import { loadSlackRuntimeConfig } from "./config.js";
import { postSlackMessage, runRuntimeDecisionCycle, runRuntimeOperatorCommand, startSlackRuntime } from "./runtime.js";

function parseArgs(argv: string[]): { command: string; post: boolean } {
  const [, , command, ...rest] = argv;
  return {
    command: command ?? "socket",
    post: rest.includes("--post")
  };
}

async function main(): Promise<void> {
  const { command, post } = parseArgs(process.argv);
  const config = loadSlackRuntimeConfig();

  if (!["socket", "cycle", "scorecard"].includes(command)) {
    throw new Error(`Unsupported command "${command}"`);
  }

  if (command === "socket") {
    await startSlackRuntime(config);
    return;
  }

  if (command === "cycle") {
    const output = await runRuntimeDecisionCycle(config);
    process.stdout.write(`${output}\n`);
    return;
  }

  const output = await runRuntimeOperatorCommand(config, "scorecard");
  process.stdout.write(`${output}\n`);
  if (post) {
    await postSlackMessage(config, output);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
