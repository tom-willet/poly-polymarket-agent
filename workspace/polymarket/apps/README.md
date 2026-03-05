# Polymarket App Adapters

Place each app in a separate directory:

- `~/.openclaw/workspace/polymarket/apps/<app_id>/README.md`
- `~/.openclaw/workspace/polymarket/apps/<app_id>/adapter.sh`

Adapter script conventions:

```bash
./adapter.sh status
./adapter.sh edge_report
./adapter.sh simulate
```

Each command should return the JSON envelope defined in:
- `~/.openclaw/workspace/skills/polymarket-orchestrator/SKILL.md`
