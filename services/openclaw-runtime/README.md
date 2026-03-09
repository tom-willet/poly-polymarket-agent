# OpenClaw Runtime Service

Initial Slack runtime adapter for the `openclaw-control` command core.

## Current scope

- Run a Slack Socket Mode app.
- Parse Slack text into operator commands, `propose`, and `cycle`.
- Call the existing `openclaw-control` command core and decision cycle.
- Return plain-text Slack responses.
- Ignore bot/subtype events so the runtime does not answer its own messages.
- Execute one command per non-empty line in a Slack message.

## Commands

```bash
pnpm --filter @poly/openclaw-runtime socket
pnpm --filter @poly/openclaw-runtime test
```

Nonprod ECS deployment:

```bash
AWS_PROFILE=mullet-dev ./scripts/deploy/deploy_openclaw_runtime_nonprod.sh
```

## Notes

- This is a runtime adapter, not a second control plane.
- Trade authority remains outside Slack.
- Allowed-user enforcement is driven by `SLACK_ALLOWED_USER_IDS`.
- The active nonprod runtime is the ECS service `poly-orchestrator-nonprod-openclaw-runtime`.
