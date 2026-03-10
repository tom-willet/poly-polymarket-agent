import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { AccountStateStore } from "./accountStateStore.js";
import { toPositionSnapshotEnvelopes } from "./accountSnapshot.js";
import { loadConfig } from "./config.js";
import { PolymarketAccountClient } from "./polymarket/accountClient.js";
import { GammaMarketClient } from "./polymarket/gammaClient.js";
import { MarketChannelClient } from "./polymarket/marketChannelClient.js";
import { createStatePublisher } from "./statePublisher.js";

function parseArgs(argv: string[]): {
  command: string;
  outputPath?: string;
  assetLimit: number;
  durationSeconds: number;
  pollIntervalSeconds: number;
} {
  const [, , command, ...rest] = argv;
  let outputPath: string | undefined;
  let assetLimit = 50;
  let durationSeconds = 30;
  let pollIntervalSeconds = 5;

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--output") {
      outputPath = rest[index + 1];
      index += 1;
    } else if (rest[index] === "--asset-limit") {
      assetLimit = Number.parseInt(rest[index + 1] ?? "", 10);
      index += 1;
    } else if (rest[index] === "--duration-seconds") {
      durationSeconds = Number.parseInt(rest[index + 1] ?? "", 10);
      index += 1;
    } else if (rest[index] === "--poll-interval-seconds") {
      pollIntervalSeconds = Number.parseInt(rest[index + 1] ?? "", 10);
      index += 1;
    }
  }

  return {
    command: command ?? "snapshot",
    outputPath,
    assetLimit: Number.isFinite(assetLimit) && assetLimit > 0 ? assetLimit : 50,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 30,
    pollIntervalSeconds: Number.isFinite(pollIntervalSeconds) && pollIntervalSeconds > 0 ? pollIntervalSeconds : 5
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function installShutdownHandlers(): { isStopping: () => boolean; cleanup: () => void } {
  let stopping = false;
  const handler = () => {
    stopping = true;
  };

  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);

  return {
    isStopping: () => stopping,
    cleanup: () => {
      process.off("SIGINT", handler);
      process.off("SIGTERM", handler);
    }
  };
}

async function publishAccountState(
  env: "sim" | "paper" | "prod",
  accountClient: PolymarketAccountClient,
  store: AccountStateStore,
  emitEnvelope: (envelope: Parameters<ReturnType<typeof createStatePublisher>["publish"]>[0]) => Promise<void>,
  staleAfterMs: number,
  tsMs = Date.now()
): Promise<void> {
  try {
    const accountSnapshot = store.apply(await accountClient.fetchAccountSnapshot(), tsMs);
    await emitEnvelope(accountSnapshot);
    const positionSnapshots = toPositionSnapshotEnvelopes(env, accountSnapshot.payload, tsMs);
    for (const positionSnapshot of positionSnapshots) {
      await emitEnvelope(positionSnapshot);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    store.recordFailure(message);
  }

  await emitEnvelope(store.health(Date.now(), staleAfterMs));
}

async function runAccountPollingWindow(
  env: "sim" | "paper" | "prod",
  accountClient: PolymarketAccountClient,
  store: AccountStateStore,
  emitEnvelope: (envelope: Parameters<ReturnType<typeof createStatePublisher>["publish"]>[0]) => Promise<void>,
  staleAfterMs: number,
  pollIntervalSeconds: number,
  durationSeconds: number,
  isStopping: () => boolean
): Promise<void> {
  const deadlineMs = Date.now() + durationSeconds * 1000;
  while (!isStopping() && Date.now() <= deadlineMs) {
    await publishAccountState(env, accountClient, store, emitEnvelope, staleAfterMs, Date.now());

    if (Date.now() + pollIntervalSeconds * 1000 > deadlineMs) {
      break;
    }
    await sleep(pollIntervalSeconds * 1000);
  }
}

async function main(): Promise<void> {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      process.exit(0);
    }

    throw error;
  });

  const { command, outputPath, assetLimit, durationSeconds, pollIntervalSeconds } = parseArgs(process.argv);
  if (!["snapshot", "stream", "account-snapshot", "account-stream", "loop"].includes(command)) {
    throw new Error(`Unsupported command "${command}"`);
  }

  const config = loadConfig();
  const publisher = createStatePublisher(config, command === "loop" ? "stream" : command);
  const gammaClient = new GammaMarketClient(config);
  const snapshot = command.startsWith("account-") ? null : await gammaClient.buildSnapshotEnvelope();

  if (command === "snapshot") {
    const rendered = `${JSON.stringify(snapshot, null, 2)}\n`;
    await publisher.publish(snapshot!);

    if (outputPath) {
      const absoluteOutputPath = path.resolve(process.cwd(), outputPath);
      await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
      await writeFile(absoluteOutputPath, rendered, "utf8");
      await publisher.close();
      process.stdout.write(`Wrote universe snapshot to ${absoluteOutputPath}\n`);
      return;
    }

    process.stdout.write(rendered);
    await publisher.close();
    return;
  }

  if (command === "account-snapshot") {
    const accountClient = new PolymarketAccountClient(config);
    const store = new AccountStateStore(config.env);
    const tsMs = Date.now();
    const accountSnapshot = store.apply(await accountClient.fetchAccountSnapshot(), tsMs);
    const accountHealth = store.health(tsMs, config.accountStateStaleAfterMs);
    const positionSnapshots = toPositionSnapshotEnvelopes(config.env, accountSnapshot.payload, tsMs);
    await publisher.publish(accountSnapshot);
    await publisher.publish(accountHealth);
    for (const positionSnapshot of positionSnapshots) {
      await publisher.publish(positionSnapshot);
    }
    const rendered = `${JSON.stringify(
      { snapshot: accountSnapshot, health: accountHealth, positions: positionSnapshots },
      null,
      2
    )}\n`;

    if (outputPath) {
      const absoluteOutputPath = path.resolve(process.cwd(), outputPath);
      await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
      await writeFile(absoluteOutputPath, rendered, "utf8");
      await publisher.close();
      process.stdout.write(`Wrote account snapshot to ${absoluteOutputPath}\n`);
      return;
    }

    process.stdout.write(rendered);
    await publisher.close();
    return;
  }

  const marketChannel = new MarketChannelClient(config);
  const absoluteOutputPath = outputPath ? path.resolve(process.cwd(), outputPath) : undefined;
  if (absoluteOutputPath) {
    await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  }
  const outputStream = absoluteOutputPath ? createWriteStream(absoluteOutputPath, { flags: "a" }) : undefined;

  const writeLine = (line: string) => {
    if (outputStream) {
      outputStream.write(line);
      return;
    }

    process.stdout.write(line);
  };

  const emitEnvelope = (envelope: Parameters<typeof publisher.publish>[0]) => {
    writeLine(`${JSON.stringify(envelope)}\n`);
    return publisher.publish(envelope);
  };

  if (command === "stream") {
    await marketChannel.streamMarkets(snapshot!.payload.markets, {
      assetLimit,
      durationSeconds,
      onSnapshot: (marketSnapshot) => {
        return emitEnvelope(marketSnapshot);
      },
      onHealth: (healthSnapshot) => {
        return emitEnvelope(healthSnapshot);
      }
    });
  } else if (command === "account-stream") {
    const accountClient = new PolymarketAccountClient(config);
    const store = new AccountStateStore(config.env);
    await runAccountPollingWindow(
      config.env,
      accountClient,
      store,
      emitEnvelope,
      config.accountStateStaleAfterMs,
      pollIntervalSeconds,
      durationSeconds,
      () => false
    );
  } else {
    const shutdown = installShutdownHandlers();
    const accountClient = config.polyUserAddress ? new PolymarketAccountClient(config) : null;
    const accountStore = new AccountStateStore(config.env);

    try {
      while (!shutdown.isStopping()) {
        const loopSnapshot = await gammaClient.buildSnapshotEnvelope();
        await emitEnvelope(loopSnapshot);

        const marketStreamPromise = marketChannel.streamMarkets(loopSnapshot.payload.markets, {
          assetLimit,
          durationSeconds,
          onSnapshot: (marketSnapshot) => emitEnvelope(marketSnapshot),
          onHealth: (healthSnapshot) => emitEnvelope(healthSnapshot)
        });

        const accountStreamPromise = accountClient
          ? runAccountPollingWindow(
              config.env,
              accountClient,
              accountStore,
              emitEnvelope,
              config.accountStateStaleAfterMs,
              pollIntervalSeconds,
              durationSeconds,
              shutdown.isStopping
            )
          : Promise.resolve();

        const [marketResult, accountResult] = await Promise.allSettled([marketStreamPromise, accountStreamPromise]);

        if (marketResult.status === "rejected") {
          const message = marketResult.reason instanceof Error ? marketResult.reason.message : String(marketResult.reason);
          process.stderr.write(`market-state loop market stream error: ${message}\n`);
        }

        if (accountResult.status === "rejected") {
          const message = accountResult.reason instanceof Error ? accountResult.reason.message : String(accountResult.reason);
          process.stderr.write(`market-state loop account stream error: ${message}\n`);
        }

        if (!shutdown.isStopping()) {
          await sleep(1000);
        }
      }
    } finally {
      shutdown.cleanup();
    }
  }

  if (outputStream) {
    await new Promise<void>((resolve, reject) => {
      outputStream.end(() => resolve());
      outputStream.on("error", reject);
    });
  }
  await publisher.close();

  if (absoluteOutputPath) {
    process.stdout.write(`Wrote ${command} output to ${absoluteOutputPath}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
