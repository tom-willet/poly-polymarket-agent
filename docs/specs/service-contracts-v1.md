# Service Contracts v1

Date: March 6, 2026

Status: Frozen for v1 implementation

## 1. Purpose

Define the internal contracts between `openclaw-control`, `market-state`, and `trade-core`. These are the schemas implementation should target first.

## 2. Contract Principles

1. Every message is versioned.
2. Every message is traceable.
3. Every decision is reproducible from recorded inputs.
4. Services exchange structured data, not prose.
5. Human-readable summaries are optional and secondary.

## 3. Common Envelope

Every internal message must use this outer envelope:

```json
{
  "schema_version": "v1",
  "env": "sim",
  "event_type": "market_snapshot",
  "service": "market-state",
  "trace_id": "trc_01HQX...",
  "ts_utc": "2026-03-06T20:00:00Z",
  "payload": {}
}
```

Required fields:

- `schema_version`
- `env`
- `event_type`
- `service`
- `trace_id`
- `ts_utc`
- `payload`

## 4. Canonical Identifiers

- `market_id`: Polymarket market identifier
- `contract_id`: outcome/asset identifier
- `market_complex_id`: internal identifier for a linked set of contracts evaluated together
- `sleeve_id`: logical strategy sleeve identifier
- `decision_id`: unique allocator or risk decision id
- `order_plan_id`: unique execution plan id

## 5. `market_snapshot`

Producer:

- `market-state`

Purpose:

- Provide current normalized state for one market or contract.

Payload:

```json
{
  "market_id": "mkt_fed_cut_march",
  "contract_id": "ct_yes",
  "market_complex_id": "cx_fed_cut_cluster",
  "status": "active",
  "mid_price": 0.62,
  "best_bid": 0.61,
  "best_ask": 0.63,
  "spread_cents": 2,
  "top_bid_size": 420.0,
  "top_ask_size": 390.0,
  "time_to_resolution_hours": 128.5,
  "book_ts_utc": "2026-03-06T20:00:00Z"
}
```

## 6. `market_data_health`

Producer:

- `market-state`

Purpose:

- Surface whether the market-data stream is fresh enough for downstream risk and execution checks.

Payload:

```json
{
  "observed_contracts": 42,
  "tracked_contracts": 50,
  "last_message_ts_utc": "2026-03-06T20:00:00Z",
  "stale_threshold_ms": 5000,
  "stale": false
}
```

## 7. `account_state_snapshot`

Producer:

- `market-state`

Purpose:

- Provide a coherent normalized view of balances, open orders, positions, and recent fills for one trading account.

Payload:

```json
{
  "user_address": "0xabc...",
  "funder_address": "0xabc...",
  "collateral": {
    "asset_type": "COLLATERAL",
    "token_id": null,
    "balance": 842.13,
    "allowance": 842.13
  },
  "open_order_count": 3,
  "position_count": 4,
  "recent_trade_count": 12,
  "total_position_value_usd": 314.52,
  "open_orders": [],
  "positions": [],
  "recent_trades": []
}
```

## 8. `account_state_health`

Producer:

- `market-state`

Purpose:

- Surface whether account/order polling is fresh and structurally coherent enough for downstream risk checks.

Payload:

```json
{
  "last_success_ts_utc": "2026-03-06T20:00:00Z",
  "stale_threshold_ms": 15000,
  "stale": false,
  "reconciliation_ok": true,
  "issues": [],
  "open_order_count": 3,
  "position_count": 4,
  "recent_trade_count": 12
}
```

## 9. `strategy_proposal`

Producer:

- `openclaw-control` sub-agents or deterministic research workers

Purpose:

- Submit one candidate opportunity to the allocator.

Payload:

```json
{
  "proposal_id": "prop_01HQX...",
  "sleeve_id": "cross_market_core",
  "market_complex_id": "cx_fed_cut_cluster",
  "thesis": "Linked contracts are misaligned after costs.",
  "contracts": [
    {
      "market_id": "mkt_a",
      "contract_id": "ct_yes",
      "side": "buy"
    },
    {
      "market_id": "mkt_b",
      "contract_id": "ct_no",
      "side": "buy"
    }
  ],
  "expected_edge_after_costs": 0.037,
  "confidence": 0.71,
  "max_holding_hours": 18,
  "invalidators": [
    "complex price gap closes below threshold",
    "top-of-book depth falls below minimum"
  ],
  "sizing_hint_usd": 40.0,
  "notes": "Auditable inconsistency; no news dependency."
}
```

Required fields:

- `proposal_id`
- `sleeve_id`
- `market_complex_id`
- `contracts`
- `expected_edge_after_costs`
- `confidence`
- `max_holding_hours`
- `invalidators`

## 10. `allocator_decision`

Producer:

- `trade-core`

Purpose:

- Record how proposals were ranked and resized before risk.

Payload:

```json
{
  "decision_id": "dec_01HQX...",
  "proposal_id": "prop_01HQX...",
  "sleeve_id": "cross_market_core",
  "rank": 1,
  "requested_notional_usd": 40.0,
  "allocated_notional_usd": 30.0,
  "status": "forwarded_to_risk",
  "reason": "Top ranked by edge and portfolio fit."
}
```

## 11. `risk_decision`

Producer:

- `trade-core`

Purpose:

- Approve, resize, or reject an allocator decision.

Payload:

```json
{
  "decision_id": "dec_01HQX...",
  "proposal_id": "prop_01HQX...",
  "status": "approved",
  "approved_notional_usd": 30.0,
  "checks": [
    {
      "name": "gross_exposure_limit",
      "result": "pass"
    },
    {
      "name": "market_complex_limit",
      "result": "pass"
    }
  ],
  "reason": "All hard checks passed."
}
```

`status` allowed values:

- `approved`
- `resized`
- `rejected`
- `halted`

## 12. `execution_intent`

Producer:

- `trade-core`

Purpose:

- Tell the execution engine what outcome to achieve without giving the LLM direct order control.

Payload:

```json
{
  "order_plan_id": "opl_01HQX...",
  "decision_id": "dec_01HQX...",
  "sleeve_id": "cross_market_core",
  "market_complex_id": "cx_fed_cut_cluster",
  "execution_style": "passive_then_cross",
  "max_notional_usd": 30.0,
  "legs": [
    {
      "market_id": "mkt_a",
      "contract_id": "ct_yes",
      "side": "buy",
      "limit_price": 0.61,
      "max_size": 20.0
    },
    {
      "market_id": "mkt_b",
      "contract_id": "ct_no",
      "side": "buy",
      "limit_price": 0.39,
      "max_size": 20.0
    }
  ],
  "expiry_utc": "2026-03-06T20:00:30Z",
  "cancel_if_unfilled": true
}
```

## 13. `execution_action`

Producer:

- `trade-core`

Purpose:

- Tell the execution worker exactly what deterministic step comes next for a live `execution_intent`.

Payload:

```json
{
  "order_plan_id": "opl_01HQX...",
  "decision_id": "dec_01HQX...",
  "status": "ready",
  "reason": "execution actions are ready",
  "actions": [
    {
      "market_id": "mkt_a",
      "contract_id": "ct_yes",
      "side": "buy",
      "action": "place_passive",
      "limit_price": 0.61,
      "size": 20.0
    }
  ]
}
```

`status` allowed values:

- `ready`
- `waiting`
- `cancel_requested`
- `completed`
- `halted`

`actions[].action` allowed values:

- `place_passive`
- `place_cross`
- `cancel`

## 14. `order_event`

Producer:

- `trade-core`

Purpose:

- Track the lifecycle of each submitted order.

Payload:

```json
{
  "order_plan_id": "opl_01HQX...",
  "order_id": "ord_12345",
  "market_id": "mkt_a",
  "contract_id": "ct_yes",
  "status": "partially_filled",
  "side": "buy",
  "limit_price": 0.61,
  "filled_size": 12.0,
  "remaining_size": 8.0,
  "event_ts_utc": "2026-03-06T20:00:04Z"
}
```

## 15. `position_snapshot`

Producer:

- `market-state`

Purpose:

- Publish current position state for risk and reporting.

Payload:

```json
{
  "wallet_id": "prod_primary",
  "sleeve_id": "cross_market_core",
  "market_complex_id": "cx_fed_cut_cluster",
  "gross_exposure_usd": 72.0,
  "net_exposure_usd": 18.0,
  "realized_pnl_usd": 14.5,
  "unrealized_pnl_usd": 2.1,
  "open_orders_reserved_usd": 20.0,
  "snapshot_ts_utc": "2026-03-06T20:01:00Z"
}
```

## 16. Slack-Facing Adapter Envelope

The existing simple adapter contract remains valid for Slack-facing tools:

```json
{
  "app_id": "example_app",
  "timestamp_utc": "2026-03-01T00:00:00Z",
  "ok": true,
  "summary": "short human-readable status",
  "data": {}
}
```

## 17. `operator_state`

Producer:

- `openclaw-control`

Purpose:

- Persist the authoritative operator control state used by downstream services.

Payload:

```json
{
  "mode": "paper",
  "paused": false,
  "flatten_requested": false,
  "updated_by": "U123456",
  "updated_at_utc": "2026-03-06T20:05:00Z"
}
```

## 18. `operator_notification`

Producer:

- `openclaw-control`

Purpose:

- Return Slack-ready command results without exposing the order path directly to the chat surface.

Payload:

```json
{
  "command_id": "cmd_01HQX...",
  "command": "status",
  "summary": "Operator status snapshot",
  "details": [
    "operator mode: paper",
    "paused: false",
    "flatten requested: false"
  ]
}
```

Rule:

- Slack-facing adapters may summarize internal state, but they must not replace the internal contracts defined here.

## 13. Idempotency and Audit

- `trace_id` must be preserved across downstream events.
- `decision_id` and `order_plan_id` must be unique and immutable.
- Replayed events must produce the same allocator and risk decisions when inputs are identical.

## 14. Related Specs

- [system-spec-v1.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/docs/specs/system-spec-v1.md)
- [risk-policy-v1.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/docs/specs/risk-policy-v1.md)
- [environment-matrix-v1.md](/Users/tomwillet/Desktop/repos/poly-polymarket-agent/docs/specs/environment-matrix-v1.md)
