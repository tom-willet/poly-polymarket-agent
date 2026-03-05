# Lightsail Setup Runbook

This runbook provisions a small but production-minded OpenClaw stack on AWS Lightsail.

## Architecture (phase 1)

- One Lightsail Ubuntu 24.04 LTS instance (`us-west-2`, `$5/month`).
- One OpenClaw gateway container, running Slack Socket Mode.
- OpenAI model selected by `OPENAI_MODEL`.
- Uses prebuilt OpenClaw image by default (`ghcr.io/openclaw/openclaw:latest`) to avoid local build OOM on small instances.
- Local hardening (UFW, fail2ban, unattended upgrades, SSH key auth option).
- Systemd units for auto-start and periodic budget checks.
- Workspace scaffold for multi-app Polymarket orchestration.

## Prerequisites

- AWS account with Lightsail access.
- OpenAI API key.
- Slack app configured for Socket Mode with bot scopes.
- This repo available locally so you can copy `deploy/lightsail` and `workspace` to the server.

## 1) Create the Lightsail instance

Recommended:
- Region: `us-west-2`.
- OS: Ubuntu 24.04 LTS.
- Plan: `$5/month`.
- Networking: keep only SSH public access.

## 2) Copy deployment assets to the instance

From your local machine:

```bash
scp -r /Users/tomwillet/Desktop/repos/poly-polymarket-agent ubuntu@<LIGHTSAIL_PUBLIC_IP>:/home/ubuntu/
```

## 3) Bootstrap host

SSH in and run:

```bash
cd /home/ubuntu/poly-polymarket-agent
chmod +x deploy/lightsail/bootstrap.sh deploy/lightsail/install_stack.sh
./deploy/lightsail/bootstrap.sh
```

Optional SSH hardening (disables password auth):

```bash
HARDEN_SSH=true ./deploy/lightsail/bootstrap.sh
```

## 4) Configure secrets and runtime settings

```bash
cp deploy/lightsail/templates/env.example deploy/lightsail/.env
nano deploy/lightsail/.env
```

Required values:
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (for GPT 5.2, set your exact model ID)
- `SLACK_APP_TOKEN`
- `SLACK_BOT_TOKEN`
- `SLACK_DM_POLICY` (`open` recommended for first bring-up)
- `OPENCLAW_GATEWAY_TOKEN` (random long string)

Example token generation:

```bash
openssl rand -hex 32
```

For Slack allowlist:
- If `SLACK_DM_POLICY=open`, allowlist is optional.
- If `SLACK_DM_POLICY=allowlist`, set `SLACK_ALLOWED_USER_IDS_JSON` to your Slack user ids.

## 5) Install and start OpenClaw stack

```bash
./deploy/lightsail/install_stack.sh
```

This script will:
- Clone `https://github.com/openclaw/openclaw`.
- Checkout `OPENCLAW_REF` (default `main`).
- Pull `OPENCLAW_IMAGE` (default `ghcr.io/openclaw/openclaw:latest`).
- If `OPENCLAW_IMAGE=openclaw:local`, build locally instead.
- Create `/opt/openclaw-stack` files, config, and workspace scaffolding.
- Install and enable `systemd` units.
- Start gateway.

## 6) Add your Slack user id to allowlist

Get your Slack Member ID (Profile -> More -> Copy member ID), then run:

```bash
sudo /opt/openclaw-stack/scripts/set_slack_allow_user.sh <YOUR_SLACK_USER_ID>
```

## 7) Slack app checklist

In [Slack API](https://api.slack.com/apps):
- Create app from scratch in your workspace.
- Optional: use this manifest to prefill settings:
  - `/home/ubuntu/poly-polymarket-agent/deploy/lightsail/templates/slack-app-manifest.yaml`
- Enable Socket Mode.
- Create an App-Level Token with `connections:write` scope (this is `SLACK_APP_TOKEN`).
- Under OAuth & Permissions, add bot scopes:
  - `app_mentions:read`
  - `chat:write`
  - `im:history`
  - `im:read`
  - `im:write`
  - `users:read`
- Install app to workspace and copy bot token (`SLACK_BOT_TOKEN`).
- Under Event Subscriptions, enable events and subscribe bot to:
  - `app_mention`
  - `message.im`
- Turn on Interactivity (request URL not required for Socket Mode).
- In your workspace, open a DM with the bot and send a message.

## 8) Validate health

```bash
sudo /opt/openclaw-stack/scripts/check_stack.sh
```

## Budget guardrails

- Recommended hard cap: set OpenAI project budget in platform UI to `$10/month`.
- Local guard runs every 15 minutes and attempts to read monthly spend:
  - Warn threshold: `BUDGET_WARN_THRESHOLD_USD` (default `8`).
  - Hard cap: `BUDGET_HARD_CAP_USD` (default `10`).
  - Enforcement mode: `BUDGET_ENFORCEMENT_MODE=enforce|advisory`.

If billing API access is not available with your key, the guard logs that state and skips enforcement.

## Useful operations

```bash
# service status
systemctl status openclaw-gateway.service --no-pager

# logs
docker compose --env-file /opt/openclaw-stack/.env -f /opt/openclaw-stack/docker-compose.yml logs -f --tail=200 openclaw-gateway

# restart
sudo systemctl restart openclaw-gateway.service

# budget guard logs
journalctl -u openclaw-budget-guard.service -n 100 --no-pager
```
