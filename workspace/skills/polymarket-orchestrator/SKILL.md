# Polymarket Orchestrator Skill

## Purpose

Coordinate multiple Polymarket app adapters from a single control agent while keeping execution auditable and reversible.

## Scope (current phase)

- No live trade execution from this skill by default.
- Planning, health checks, dry-run workflow, and adapter interface validation only.

## Adapter contract

Each app adapter should expose:
- `id`: unique short app name.
- `status`: health and readiness output in JSON.
- `edge_report`: current opportunity analysis in JSON.
- `simulate`: dry-run action output in JSON.

Required JSON envelope for every command:

```json
{
  "app_id": "example_app",
  "timestamp_utc": "2026-03-01T00:00:00Z",
  "ok": true,
  "summary": "short human-readable status",
  "data": {}
}
```

## Directory layout

- `~/.openclaw/workspace/polymarket/apps/<app_id>/`
- `~/.openclaw/workspace/polymarket/apps/<app_id>/README.md`
- `~/.openclaw/workspace/polymarket/apps/<app_id>/adapter.sh`

## Operator rules

- Refuse any command that implies illegal market manipulation or non-compliant behavior.
- Treat missing data as a hard block for execution recommendations.
- Prefer dry-run and explicit confirmation steps.
- Keep per-app decisions isolated: one app failure must not silently block all app status checks.
