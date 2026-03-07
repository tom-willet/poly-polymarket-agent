# Market-State Service

Initial `M1` implementation for market discovery, top-of-book normalization, and market-data health checks.

## Current scope

- Fetch active markets from Polymarket Gamma.
- Normalize them into a stable internal universe record.
- Subscribe to the public Polymarket market WebSocket by asset id.
- Poll authenticated account state from the Polymarket CLOB and Data API.
- Derive `position_snapshot` records from authenticated account positions.
- Emit NDJSON state events.
- Persist latest canonical state to DynamoDB when `STATE_CURRENT_TABLE` is configured.
- Archive emitted state events to S3 when `STATE_ARCHIVE_BUCKET` is configured.

## Persistence behavior

- Compact latest-state records are written to DynamoDB current-state.
- Full event streams are archived to S3 as NDJSON.
- `market_universe_snapshot` is archived to S3 only.
- `position_snapshot` is written to current-state by wallet and market complex.

Reason:

- The full universe payload is too large for a single DynamoDB item, so current-state storage is intentionally limited to compact per-contract and health records.

## Commands

```bash
pnpm --filter @poly/market-state snapshot
pnpm --filter @poly/market-state snapshot -- --output runtime/universe.json
pnpm --filter @poly/market-state stream -- --asset-limit 50 --duration-seconds 30
pnpm --filter @poly/market-state stream -- --asset-limit 50 --duration-seconds 30 --output runtime/stream.ndjson
pnpm --filter @poly/market-state account-snapshot
pnpm --filter @poly/market-state account-stream -- --duration-seconds 30 --poll-interval-seconds 5
pnpm --filter @poly/market-state test
```

`stream` writes one JSON envelope per line. This makes it usable for local piping, replay capture, and downstream ingestion.
`account-snapshot` and `account-stream` emit `account_state_snapshot`, `account_state_health`, and one `position_snapshot` per open position.

## Environment variables

- `POLY_GAMMA_BASE_URL`
- `STATE_CURRENT_TABLE`
- `STATE_ARCHIVE_BUCKET`
- `STATE_ARCHIVE_PREFIX`
- `POLY_CLOB_BASE_URL`
- `POLY_DATA_BASE_URL`
- `POLY_MARKET_WS_URL`
- `POLY_GAMMA_PAGE_SIZE`
- `POLY_GAMMA_MAX_PAGES`
- `POLY_MARKET_DATA_STALE_AFTER_MS`
- `POLY_ACCOUNT_STATE_STALE_AFTER_MS`
- `POLY_CHAIN_ID`
- `POLY_SIGNATURE_TYPE`
- `POLY_USER_ADDRESS`
- `POLY_FUNDER_ADDRESS`
- `POLY_PRIVATE_KEY`
- `POLY_CLOB_API_KEY`
- `POLY_CLOB_API_SECRET`
- `POLY_CLOB_API_PASSPHRASE`
- `POLY_POSITIONS_SIZE_THRESHOLD`
- `POLY_POSITIONS_LIMIT`
- `POLYMARKET_INCLUDE_RESTRICTED`

Defaults are tuned for the public Gamma API in `us-west-2`-hosted operator workflows.
