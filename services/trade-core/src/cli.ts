import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { allocateProposals, type ExposureState } from "./allocator.js";
import { loadAllocatorConfig } from "./config.js";
import type { StrategyProposalPayload } from "./contracts.js";
import { buildExecutionIntent, type ExecutionPlanningInput } from "./execution.js";
import { loadExecutionConfig } from "./executionConfig.js";
import { evaluateExecutionAction, type ExecutionActionInput } from "./executionPolicy.js";
import { evaluateRisk, type RiskEvaluationInput } from "./risk.js";
import { loadRiskConfig } from "./riskConfig.js";
import {
  assembleExecutionPlanningInputFromState,
  assembleRiskInputFromState,
  loadCurrentStateReaderFromEnv
} from "./stateReader.js";

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
    command: command ?? "allocate",
    inputPath
  };
}

async function readProposals(inputPath?: string): Promise<StrategyProposalPayload[]> {
  if (!inputPath) {
    throw new Error("allocate requires --input <path-to-json>");
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const body = await readFile(absolutePath, "utf8");
  const parsed = JSON.parse(body) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("allocator input must be a JSON array");
  }

  return parsed as StrategyProposalPayload[];
}

async function readRiskInput(inputPath?: string): Promise<RiskEvaluationInput> {
  if (!inputPath) {
    throw new Error("risk requires --input <path-to-json>");
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const body = await readFile(absolutePath, "utf8");
  return JSON.parse(body) as RiskEvaluationInput;
}

async function readExecutionInput(inputPath?: string): Promise<ExecutionPlanningInput> {
  if (!inputPath) {
    throw new Error("plan requires --input <path-to-json>");
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const body = await readFile(absolutePath, "utf8");
  return JSON.parse(body) as ExecutionPlanningInput;
}

async function readExecutionActionInput(inputPath?: string): Promise<ExecutionActionInput> {
  if (!inputPath) {
    throw new Error("act requires --input <path-to-json>");
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const body = await readFile(absolutePath, "utf8");
  return JSON.parse(body) as ExecutionActionInput;
}

async function readJsonObject<T>(inputPath: string | undefined, command: string): Promise<T> {
  if (!inputPath) {
    throw new Error(`${command} requires --input <path-to-json>`);
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const body = await readFile(absolutePath, "utf8");
  return JSON.parse(body) as T;
}

function emptyExposure(): ExposureState {
  return {
    grossReservedUsd: 0,
    sleeveReservedUsd: {},
    marketComplexReservedUsd: {},
    contractReservedUsd: {}
  };
}

async function main(): Promise<void> {
  const { command, inputPath } = parseArgs(process.argv);
  if (!["allocate", "risk", "plan", "act", "hydrate-risk", "hydrate-plan"].includes(command)) {
    throw new Error(`Unsupported command "${command}"`);
  }

  if (command === "allocate") {
    const proposals = await readProposals(inputPath);
    const decisions = allocateProposals(proposals, {
      config: loadAllocatorConfig(),
      exposure: emptyExposure()
    });

    process.stdout.write(`${JSON.stringify(decisions, null, 2)}\n`);
    return;
  }

  const allocatorConfig = loadAllocatorConfig();
  if (command === "risk") {
    const input = await readRiskInput(inputPath);
    const decision = evaluateRisk(input, {
      env: allocatorConfig.env,
      allocatorConfig,
      riskConfig: loadRiskConfig()
    });
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
    return;
  }

  if (command === "hydrate-risk") {
    const reader = loadCurrentStateReaderFromEnv();
    const input = await readJsonObject<{
      allocatorDecision: RiskEvaluationInput["allocatorDecision"];
      proposal: RiskEvaluationInput["proposal"];
      accountUserAddress: string;
      operatorState: RiskEvaluationInput["operatorState"];
      performance: RiskEvaluationInput["performance"];
      estimatedTotalCostsUsd?: number;
      executionHeartbeatHealthy: boolean;
    }>(inputPath, "hydrate-risk");
    const hydrated = await assembleRiskInputFromState(reader, input);
    process.stdout.write(`${JSON.stringify(hydrated, null, 2)}\n`);
    return;
  }

  if (command === "hydrate-plan") {
    const reader = loadCurrentStateReaderFromEnv();
    const input = await readJsonObject<{
      allocatorDecision: ExecutionPlanningInput["allocatorDecision"];
      proposal: ExecutionPlanningInput["proposal"];
      accountUserAddress: string;
      riskDecision: ExecutionPlanningInput["riskDecision"] & { status: "approved" | "resized" };
    }>(inputPath, "hydrate-plan");
    const hydrated = await assembleExecutionPlanningInputFromState(reader, input);
    process.stdout.write(`${JSON.stringify(hydrated, null, 2)}\n`);
    return;
  }

  const executionConfig = loadExecutionConfig();
  if (command === "plan") {
    const input = await readExecutionInput(inputPath);
    const intent = buildExecutionIntent(input, executionConfig, allocatorConfig.env);
    process.stdout.write(`${JSON.stringify(intent, null, 2)}\n`);
    return;
  }

  const actionInput = await readExecutionActionInput(inputPath);
  const action = evaluateExecutionAction(actionInput, executionConfig);
  process.stdout.write(`${JSON.stringify(action, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
