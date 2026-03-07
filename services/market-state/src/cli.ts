import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadConfig } from "./config.js";
import { GammaMarketClient } from "./polymarket/gammaClient.js";
import { MarketChannelClient } from "./polymarket/marketChannelClient.js";

function parseArgs(argv: string[]): {
  command: string;
  outputPath?: string;
  assetLimit: number;
  durationSeconds: number;
} {
  const [, , command, ...rest] = argv;
  let outputPath: string | undefined;
  let assetLimit = 50;
  let durationSeconds = 30;

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
    }
  }

  return {
    command: command ?? "snapshot",
    outputPath,
    assetLimit: Number.isFinite(assetLimit) && assetLimit > 0 ? assetLimit : 50,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 30
  };
}

async function main(): Promise<void> {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      process.exit(0);
    }

    throw error;
  });

  const { command, outputPath, assetLimit, durationSeconds } = parseArgs(process.argv);
  if (!["snapshot", "stream"].includes(command)) {
    throw new Error(`Unsupported command "${command}"`);
  }

  const config = loadConfig();
  const client = new GammaMarketClient(config);
  const snapshot = await client.buildSnapshotEnvelope();

  if (command === "snapshot") {
    const rendered = `${JSON.stringify(snapshot, null, 2)}\n`;

    if (outputPath) {
      const absoluteOutputPath = path.resolve(process.cwd(), outputPath);
      await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
      await writeFile(absoluteOutputPath, rendered, "utf8");
      process.stdout.write(`Wrote universe snapshot to ${absoluteOutputPath}\n`);
      return;
    }

    process.stdout.write(rendered);
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

  await marketChannel.streamMarkets(snapshot.payload.markets, {
    assetLimit,
    durationSeconds,
    onSnapshot: (marketSnapshot) => {
      writeLine(`${JSON.stringify(marketSnapshot)}\n`);
    },
    onHealth: (healthSnapshot) => {
      writeLine(`${JSON.stringify(healthSnapshot)}\n`);
    }
  });

  if (outputStream) {
    await new Promise<void>((resolve, reject) => {
      outputStream.end(() => resolve());
      outputStream.on("error", reject);
    });
  }

  if (absoluteOutputPath) {
    process.stdout.write(`Wrote market snapshots to ${absoluteOutputPath}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
