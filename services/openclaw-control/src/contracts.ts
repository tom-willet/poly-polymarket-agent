export interface EventEnvelope<T> {
  schema_version: "v1";
  env: "sim" | "paper" | "prod";
  event_type: string;
  service: "openclaw-control";
  trace_id: string;
  ts_utc: string;
  payload: T;
}

export interface OperatorCommandPayload {
  command_id: string;
  user_id: string;
  channel_id: string;
  command: "status" | "why" | "risk" | "pause" | "resume" | "flatten" | "mode" | "sleeves";
  args?: string[];
}

export interface OperatorStatePayload {
  mode: "sim" | "paper" | "prod";
  paused: boolean;
  flatten_requested: boolean;
  updated_by: string;
  updated_at_utc: string;
}

export interface OperatorNotificationPayload {
  command_id: string;
  command: OperatorCommandPayload["command"];
  summary: string;
  details: string[];
}
