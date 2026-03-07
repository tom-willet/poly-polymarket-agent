# Market-State Service

Initial `M1` implementation for market discovery, top-of-book normalization, and market-data health checks.

## Current scope

- Fetch active markets from Polymarket Gamma.
- Normalize them into a stable internal universe record.
- Subscribe to the public Polymarket market WebSocket by asset id.
- Emit NDJSON `market_snapshot` updates and a terminal `market_data_health` event.

## Commands

```bash
pnpm --filter @poly/market-state snapshot
pnpm --filter @poly/market-state snapshot -- --output runtime/universe.json
pnpm --filter @poly/market-state stream -- --asset-limit 50 --duration-seconds 30
pnpm --filter @poly/market-state stream -- --asset-limit 50 --duration-seconds 30 --output runtime/stream.ndjson
pnpm --filter @poly/market-state test
```

`stream` writes one JSON envelope per line. This makes it usable for local piping, replay capture, and downstream ingestion.

## Environment variables

- `POLY_GAMMA_BASE_URL`
- `POLY_MARKET_WS_URL`
- `POLY_GAMMA_PAGE_SIZE`
- `POLY_GAMMA_MAX_PAGES`
- `POLY_MARKET_DATA_STALE_AFTER_MS`
- `POLYMARKET_INCLUDE_RESTRICTED`

Defaults are tuned for the public Gamma API in `us-west-2`-hosted operator workflows.
