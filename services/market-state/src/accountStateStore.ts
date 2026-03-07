import {
  toAccountStateHealthEnvelope,
  toAccountStateSnapshotEnvelope,
  type AccountStateHealthPayload,
  type AccountStateSnapshotPayload
} from "./accountSnapshot.js";

function evaluateSnapshotIssues(snapshot: AccountStateSnapshotPayload): string[] {
  const issues: string[] = [];
  const orderIds = new Set<string>();
  const positionIds = new Set<string>();

  if (snapshot.collateral.balance === null) {
    issues.push("collateral balance missing");
  }
  if (snapshot.collateral.allowance === null) {
    issues.push("collateral allowance missing");
  }

  for (const order of snapshot.open_orders) {
    if (orderIds.has(order.order_id)) {
      issues.push(`duplicate open order id: ${order.order_id}`);
    }
    orderIds.add(order.order_id);

    if (!order.contract_id) {
      issues.push(`open order ${order.order_id} missing contract_id`);
    }
    if (order.remaining_size !== null && order.remaining_size < 0) {
      issues.push(`open order ${order.order_id} has negative remaining size`);
    }
  }

  for (const position of snapshot.positions) {
    const positionKey = `${position.contract_id}:${position.outcome ?? ""}`;
    if (positionIds.has(positionKey)) {
      issues.push(`duplicate position key: ${positionKey}`);
    }
    positionIds.add(positionKey);

    if (position.size !== null && position.size < 0) {
      issues.push(`position ${position.contract_id} has negative size`);
    }
  }

  return issues;
}

export class AccountStateStore {
  private lastSnapshot: AccountStateSnapshotPayload | null = null;
  private lastSuccessTsMs: number | null = null;
  private lastIssues: string[] = ["no successful account refresh yet"];
  private lastError: string | null = null;

  constructor(private readonly env: "sim" | "paper" | "prod") {}

  apply(snapshot: AccountStateSnapshotPayload, tsMs: number) {
    this.lastSnapshot = snapshot;
    this.lastSuccessTsMs = tsMs;
    this.lastIssues = evaluateSnapshotIssues(snapshot);
    this.lastError = null;

    return toAccountStateSnapshotEnvelope(this.env, snapshot, tsMs);
  }

  recordFailure(message: string) {
    this.lastError = message;
  }

  health(nowMs: number, staleThresholdMs: number) {
    const issues = [...this.lastIssues];
    if (this.lastError) {
      issues.unshift(`last refresh failed: ${this.lastError}`);
    }

    const snapshot = this.lastSnapshot;
    const payload: AccountStateHealthPayload = {
      last_success_ts_utc: this.lastSuccessTsMs === null ? null : new Date(this.lastSuccessTsMs).toISOString(),
      stale_threshold_ms: staleThresholdMs,
      stale: this.lastSuccessTsMs === null ? true : nowMs - this.lastSuccessTsMs > staleThresholdMs,
      reconciliation_ok: issues.length === 0,
      issues,
      open_order_count: snapshot?.open_order_count ?? 0,
      position_count: snapshot?.position_count ?? 0,
      recent_trade_count: snapshot?.recent_trade_count ?? 0
    };

    return toAccountStateHealthEnvelope(this.env, payload, nowMs);
  }
}
