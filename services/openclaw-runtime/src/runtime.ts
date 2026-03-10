import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import {
  DynamoDbCurrentStateStore,
  DynamoDbDecisionLedgerStore,
  generateCrossMarketConsistencyProposals,
  handleOperatorCommand,
  runDecisionCycle,
  type CurrentStateStore,
  type DecisionLedgerStore
} from "@poly/openclaw-control";
import { loadControlConfig } from "@poly/openclaw-control";
import { DynamoDbCurrentStateReader, type CurrentStateReader } from "@poly/trade-core";
import type { SlackRuntimeConfig } from "./config.js";
import { renderDecisionCycle, renderHelp, renderOperatorNotification, renderProposals } from "./format.js";
import { parseSlackCommand } from "./parser.js";

export interface RuntimeDependencies {
  currentState: CurrentStateStore;
  currentStateReader: CurrentStateReader;
  decisionLedger: DecisionLedgerStore;
}

export function createRuntimeDependencies(config: SlackRuntimeConfig): RuntimeDependencies {
  return {
    currentState: new DynamoDbCurrentStateStore(config.currentStateTableName),
    currentStateReader: new DynamoDbCurrentStateReader(config.currentStateTableName),
    decisionLedger: new DynamoDbDecisionLedgerStore(config.decisionLedgerTableName)
  };
}

function isAllowed(userId: string | undefined, allowedUserIds: string[]): boolean {
  if (!userId) {
    return false;
  }
  if (allowedUserIds.length === 0) {
    return true;
  }
  return allowedUserIds.includes(userId);
}

async function renderSlackCommand(
  text: string,
  metadata: { userId: string; channelId: string },
  config: SlackRuntimeConfig,
  deps: RuntimeDependencies
): Promise<string> {
  const parsed = parseSlackCommand(text);
  const controlConfig = loadControlConfig();

  if (parsed.kind === "operator") {
    const response = await handleOperatorCommand(
      {
        command_id: crypto.randomUUID(),
        user_id: metadata.userId,
        channel_id: metadata.channelId,
        command: parsed.command,
        args: parsed.args
      },
      {
        env: config.env,
        defaultMode: controlConfig.defaultMode,
        currentState: deps.currentState,
        decisionLedger: deps.decisionLedger
      }
    );
    return renderOperatorNotification(response);
  }

  if (parsed.kind === "propose") {
    const proposals = await generateCrossMarketConsistencyProposals({
      env: config.env,
      config: controlConfig,
      currentState: deps.currentState
    });
    return renderProposals(proposals.map((proposal) => proposal.payload));
  }

  if (parsed.kind === "cycle") {
    const cycle = await runDecisionCycle({
      env: config.env,
      config: controlConfig,
      currentState: deps.currentState,
      currentStateReader: deps.currentStateReader,
      decisionLedger: deps.decisionLedger
    });
    return renderDecisionCycle(cycle);
  }

  return renderHelp();
}

function splitSlackCommands(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function shouldIgnoreSlackMessage(message: Record<string, unknown>): boolean {
  const subtype = typeof message.subtype === "string" ? message.subtype : undefined;
  if (subtype) {
    return true;
  }

  if (typeof message.bot_id === "string" && message.bot_id.length > 0) {
    return true;
  }

  if (typeof message.app_id === "string" && message.app_id.length > 0) {
    return true;
  }

  return false;
}

export async function handleSlackText(
  text: string,
  metadata: { userId: string; channelId: string },
  config: SlackRuntimeConfig,
  deps: RuntimeDependencies
): Promise<string> {
  if (!isAllowed(metadata.userId, config.slackAllowedUserIds)) {
    return "User is not allowed to run operator commands.";
  }

  const commands = splitSlackCommands(text);
  if (commands.length === 0) {
    return renderHelp();
  }

  const responses: string[] = [];
  for (const commandText of commands) {
    responses.push(await renderSlackCommand(commandText, metadata, config, deps));
  }

  return responses.join("\n\n");
}

export function createSlackApp(
  config: SlackRuntimeConfig,
  deps = createRuntimeDependencies(config)
): App {
  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true
  });

  const handleMessage = async ({
    text,
    user,
    channel,
    say
  }: {
    text?: string;
    user?: string;
    channel?: string;
    say: (message: string) => Promise<unknown>;
  }) => {
    const response = await handleSlackText(
      text ?? "",
      {
        userId: user ?? "unknown",
        channelId: channel ?? "unknown"
      },
      config,
      deps
    );
    await say(response);
  };

  app.event("app_mention", async ({ event, say }) => {
    await handleMessage({
      text: "text" in event ? event.text : "",
      user: "user" in event ? event.user : undefined,
      channel: "channel" in event ? event.channel : undefined,
      say
    });
  });

  app.message(async ({ message, say }) => {
    if (!("channel_type" in message) || message.channel_type !== "im") {
      return;
    }
    if (shouldIgnoreSlackMessage(message as unknown as Record<string, unknown>)) {
      return;
    }

    await handleMessage({
      text: "text" in message ? message.text : "",
      user: "user" in message ? message.user : undefined,
      channel: "channel" in message ? message.channel : undefined,
      say
    });
  });

  return app;
}

export async function startSlackRuntime(config: SlackRuntimeConfig): Promise<void> {
  const app = createSlackApp(config);
  await app.start();
}

export async function runRuntimeDecisionCycle(
  config: SlackRuntimeConfig,
  deps = createRuntimeDependencies(config)
): Promise<string> {
  const controlConfig = loadControlConfig();
  const cycle = await runDecisionCycle({
    env: config.env,
    config: controlConfig,
    currentState: deps.currentState,
    currentStateReader: deps.currentStateReader,
    decisionLedger: deps.decisionLedger
  });
  return renderDecisionCycle(cycle);
}

export async function runRuntimeOperatorCommand(
  config: SlackRuntimeConfig,
  command: "scorecard",
  deps = createRuntimeDependencies(config)
): Promise<string> {
  const controlConfig = loadControlConfig();
  const response = await handleOperatorCommand(
    {
      command_id: crypto.randomUUID(),
      user_id: "system",
      channel_id: "system",
      command
    },
    {
      env: config.env,
      defaultMode: controlConfig.defaultMode,
      currentState: deps.currentState,
      decisionLedger: deps.decisionLedger
    }
  );
  return renderOperatorNotification(response);
}

export async function postSlackMessage(config: SlackRuntimeConfig, text: string): Promise<void> {
  if (config.slackReportUserIds.length === 0) {
    throw new Error("SLACK_REPORT_USER_IDS is required for scheduled Slack posts");
  }

  const client = new WebClient(config.slackBotToken);
  for (const recipient of config.slackReportUserIds) {
    await client.chat.postMessage({
      channel: recipient,
      text
    });
  }
}
