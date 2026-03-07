export interface HeartbeatHealth {
  active: boolean;
  healthy: boolean;
  last_sent_ts_utc: string | null;
  last_ack_ts_utc: string | null;
  heartbeat_id: string | null;
  timeout_ms: number;
}

export class HeartbeatManager {
  private heartbeatId: string | null = null;
  private lastSentAtMs: number | null = null;
  private lastAckAtMs: number | null = null;

  constructor(
    private readonly sendIntervalMs: number,
    private readonly timeoutMs: number
  ) {}

  shouldSend(nowMs: number): boolean {
    return this.lastSentAtMs === null || nowMs - this.lastSentAtMs >= this.sendIntervalMs;
  }

  nextHeartbeatPayload(nowMs: number): { heartbeat_id: string } {
    this.lastSentAtMs = nowMs;
    return {
      heartbeat_id: this.heartbeatId ?? ""
    };
  }

  recordAck(heartbeatId: string, nowMs: number): void {
    this.heartbeatId = heartbeatId;
    this.lastAckAtMs = nowMs;
  }

  health(nowMs: number): HeartbeatHealth {
    return {
      active: this.lastSentAtMs !== null,
      healthy: this.lastAckAtMs !== null && nowMs - this.lastAckAtMs <= this.timeoutMs,
      last_sent_ts_utc: this.lastSentAtMs === null ? null : new Date(this.lastSentAtMs).toISOString(),
      last_ack_ts_utc: this.lastAckAtMs === null ? null : new Date(this.lastAckAtMs).toISOString(),
      heartbeat_id: this.heartbeatId,
      timeout_ms: this.timeoutMs
    };
  }
}
