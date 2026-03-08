# OpenClaw Runtime Service

Initial Slack runtime adapter for the `openclaw-control` command core.

## Current scope

- Run a Slack Socket Mode app.
- Parse Slack text into operator commands, `propose`, and `cycle`.
- Call the existing `openclaw-control` command core and decision cycle.
- Return plain-text Slack responses.

## Commands

```bash
pnpm --filter @poly/openclaw-runtime socket
pnpm --filter @poly/openclaw-runtime test
```

## Notes

- This is a runtime adapter, not a second control plane.
- Trade authority remains outside Slack.
- Allowed-user enforcement is driven by `SLACK_ALLOWED_USER_IDS`.
