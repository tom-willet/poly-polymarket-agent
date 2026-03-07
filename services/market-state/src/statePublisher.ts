import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { AppConfig } from "./config.js";
import type { EventEnvelope } from "./contracts.js";
import { archiveKeyForCommand, currentStateKeyForEnvelope, type CurrentStateKey } from "./stateKeys.js";

interface CurrentStateWriter {
  putLatest(key: CurrentStateKey, envelope: EventEnvelope<unknown>): Promise<void>;
}

interface EventArchiveWriter {
  append(envelope: EventEnvelope<unknown>): Promise<void>;
  close(): Promise<void>;
}

class DynamoDbCurrentStateWriter implements CurrentStateWriter {
  constructor(
    private readonly tableName: string,
    private readonly documentClient: DynamoDBDocumentClient
  ) {}

  async putLatest(key: CurrentStateKey, envelope: EventEnvelope<unknown>): Promise<void> {
    await this.documentClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: key.pk,
          sk: key.sk,
          schema_version: envelope.schema_version,
          env: envelope.env,
          event_type: envelope.event_type,
          service: envelope.service,
          trace_id: envelope.trace_id,
          ts_utc: envelope.ts_utc,
          payload: envelope.payload
        }
      })
    );
  }
}

class S3NdjsonArchiveWriter implements EventArchiveWriter {
  private tempDirPath: string | null = null;
  private tempFilePath: string | null = null;
  private fileStream: WriteStream | null = null;
  private hasEvents = false;

  constructor(
    private readonly bucketName: string,
    private readonly objectKey: string,
    private readonly s3Client: S3Client
  ) {}

  async append(envelope: EventEnvelope<unknown>): Promise<void> {
    if (!this.fileStream) {
      await this.initialize();
    }

    this.hasEvents = true;
    const line = `${JSON.stringify(envelope)}\n`;
    if (!this.fileStream!.write(line)) {
      await once(this.fileStream!, "drain");
    }
  }

  async close(): Promise<void> {
    if (!this.fileStream || !this.tempFilePath || !this.tempDirPath) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.fileStream!.end((error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    if (this.hasEvents) {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: this.objectKey,
          Body: createReadStream(this.tempFilePath),
          ContentType: "application/x-ndjson"
        })
      );
    }

    await rm(this.tempDirPath, { recursive: true, force: true });
    this.fileStream = null;
    this.tempDirPath = null;
    this.tempFilePath = null;
  }

  private async initialize(): Promise<void> {
    this.tempDirPath = await mkdtemp(path.join(tmpdir(), "poly-market-state-"));
    this.tempFilePath = path.join(this.tempDirPath, "events.ndjson");
    this.fileStream = createWriteStream(this.tempFilePath, { flags: "a" });
  }
}

export class StatePublisher {
  private publishQueue = Promise.resolve();

  constructor(
    private readonly options: {
      currentStateWriter?: CurrentStateWriter;
      eventArchiveWriter?: EventArchiveWriter;
      defaultAccountUserAddress?: string;
    }
  ) {}

  publish(envelope: EventEnvelope<unknown>): Promise<void> {
    this.publishQueue = this.publishQueue.then(async () => {
      const currentKey = currentStateKeyForEnvelope(envelope, this.options.defaultAccountUserAddress);
      if (currentKey && this.options.currentStateWriter) {
        await this.options.currentStateWriter.putLatest(currentKey, envelope);
      }
      if (this.options.eventArchiveWriter) {
        await this.options.eventArchiveWriter.append(envelope);
      }
    });

    return this.publishQueue;
  }

  async close(): Promise<void> {
    await this.publishQueue;
    if (this.options.eventArchiveWriter) {
      await this.options.eventArchiveWriter.close();
    }
  }
}

export function createStatePublisher(config: AppConfig, command: string): StatePublisher {
  const currentStateWriter = config.stateCurrentTableName
    ? new DynamoDbCurrentStateWriter(
        config.stateCurrentTableName,
        DynamoDBDocumentClient.from(new DynamoDBClient({}))
      )
    : undefined;

  const archiveWriter = config.stateArchiveBucketName
    ? new S3NdjsonArchiveWriter(
        config.stateArchiveBucketName,
        archiveKeyForCommand(config.env, config.stateArchivePrefix, command, Date.now()),
        new S3Client({})
      )
    : undefined;

  return new StatePublisher({
    currentStateWriter,
    eventArchiveWriter: archiveWriter,
    defaultAccountUserAddress: config.polyUserAddress || undefined
  });
}
