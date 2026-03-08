import { App } from "@slack/bolt";
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
import type { SlackRuntimeConfig } from "./config.js";
import { renderDecisionCycle, renderHelp, renderOperatorNotification, renderProposals } from "./format.js";
import { parseSlackCommand } from "./parser.js";

export interface RuntimeDependencies {
  currentState: CurrentStateStore;
  decisionLedger: DecisionLedgerStore;
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

export async function handleSlackText(
  text: string,
  metadata: { userId: string; channelId: string },
  config: SlackRuntimeConfig,
  deps: RuntimeDependencies
): Promise<string> {
  if (!isAllowed(metadata.userId, config.slackAllowedUserIds)) {
    return "User is not allowed to run operator commands.";
  }

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
      currentStateReader: deps.currentState,
      decisionLedger: deps.decisionLedger
    });
    return renderDecisionCycle(cycle);
  }

  return renderHelp();
}

export function createSlackApp(
  config: SlackRuntimeConfig,
  deps = {
    currentState: new DynamoDbCurrentStateStore(config.currentStateTableName),
    decisionLedger: new DynamoDbDecisionLedgerStore(config.decisionLedgerTableName)
  }
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
