import type { EventEnvelope, PositionSnapshotPayload } from "./contracts.js";
import type { AccountStateHealthPayload, AccountStateSnapshotPayload } from "./accountSnapshot.js";
import type { MarketDataHealth, MarketSnapshotPayload } from "./marketSnapshot.js";

export interface CurrentStateKey {
  pk: string;
  sk: string;
}

export function currentStateKeyForEnvelope(
  envelope: EventEnvelope<unknown>,
  defaultAccountUserAddress?: string
): CurrentStateKey | null {
  switch (envelope.event_type) {
    case "market_snapshot": {
      const payload = envelope.payload as MarketSnapshotPayload;
      return {
        pk: `market#${payload.contract_id}`,
        sk: "snapshot"
      };
    }
    case "market_data_health":
      return {
        pk: "health#market-data",
        sk: "latest"
      };
    case "account_state_snapshot": {
      const payload = envelope.payload as AccountStateSnapshotPayload;
      return {
        pk: `account#${payload.user_address}`,
        sk: "snapshot"
      };
    }
    case "account_state_health": {
      const payload = envelope.payload as AccountStateHealthPayload;
      return {
        pk: `account#${defaultAccountUserAddress ?? payload.last_success_ts_utc ?? "unknown"}`,
        sk: "health"
      };
    }
    case "position_snapshot": {
      const payload = envelope.payload as PositionSnapshotPayload;
      return {
        pk: `position#${payload.wallet_id}#${payload.market_complex_id}`,
        sk: "snapshot"
      };
    }
    default:
      return null;
  }
}

export function archiveKeyForCommand(
  env: "sim" | "paper" | "prod",
  prefix: string,
  command: string,
  startedAtMs: number
): string {
  const startedAt = new Date(startedAtMs);
  const year = startedAt.getUTCFullYear();
  const month = String(startedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(startedAt.getUTCDate()).padStart(2, "0");
  const timestamp = startedAt.toISOString().replaceAll(":", "-");

  return `${prefix}/${env}/${year}/${month}/${day}/${command}/${timestamp}.ndjson`;
}

export type KnownStateEnvelope =
  | EventEnvelope<MarketSnapshotPayload>
  | EventEnvelope<MarketDataHealth>
  | EventEnvelope<AccountStateSnapshotPayload>
  | EventEnvelope<AccountStateHealthPayload>
  | EventEnvelope<PositionSnapshotPayload>;
