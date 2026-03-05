#!/usr/bin/env python3
import datetime as dt
import json
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


STACK_ROOT = pathlib.Path(os.getenv("STACK_ROOT", "/opt/openclaw-stack"))
RUNTIME_DIR = STACK_ROOT / "runtime"
LOCK_FILE = RUNTIME_DIR / "budget.lock.json"


def log(message: str) -> None:
    print(f"[budget-guard] {message}")


def month_window_utc(now: dt.datetime) -> tuple[int, int, str, str]:
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if now.month == 12:
        next_month = now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        next_month = now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    start_ts = int(start.timestamp())
    end_ts = int(next_month.timestamp())
    return start_ts, end_ts, start.strftime("%Y-%m"), start.strftime("%Y-%m-%d")


def request_json(url: str, api_key: str) -> dict:
    req = urllib.request.Request(
        url=url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        payload = response.read().decode("utf-8")
        return json.loads(payload)


def fetch_cost_usd(api_key: str, start_ts: int, end_ts: int) -> float | None:
    params = urllib.parse.urlencode({"start_time": start_ts, "end_time": end_ts})
    try:
        data = request_json(f"https://api.openai.com/v1/organization/costs?{params}", api_key)
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403, 404}:
            log(f"Billing endpoint unavailable with current key (HTTP {exc.code}); skipping enforcement")
            return None
        raise

    rows = data.get("data")
    if isinstance(rows, list):
        total = 0.0
        found = False
        for row in rows:
            if not isinstance(row, dict):
                continue
            amount = row.get("amount")
            if isinstance(amount, dict):
                value = amount.get("value")
                currency = str(amount.get("currency", "usd")).lower()
                if isinstance(value, (int, float)) and currency == "usd":
                    total += float(value)
                    found = True
        if found:
            return total

    # Fallback for older response shapes.
    total_cost = data.get("total_cost_usd")
    if isinstance(total_cost, (int, float)):
        return float(total_cost)

    return None


def compose_cmd(*args: str) -> list[str]:
    return [
        "docker",
        "compose",
        "--env-file",
        str(STACK_ROOT / ".env"),
        "-f",
        str(STACK_ROOT / "docker-compose.yml"),
        *args,
    ]


def run_compose(*args: str) -> int:
    cmd = compose_cmd(*args)
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        log(f"docker compose {' '.join(args)} failed: {proc.stderr.strip()}")
    return proc.returncode


def write_lock(month_key: str, cost_usd: float, cap_usd: float) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    LOCK_FILE.write_text(
        json.dumps(
            {
                "month": month_key,
                "cost_usd": round(cost_usd, 4),
                "cap_usd": round(cap_usd, 4),
                "updated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def read_lock() -> dict | None:
    if not LOCK_FILE.exists():
        return None
    try:
        return json.loads(LOCK_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def clear_lock() -> None:
    if LOCK_FILE.exists():
        LOCK_FILE.unlink()


def main() -> int:
    api_key = os.getenv("OPENAI_BILLING_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        log("No OPENAI_API_KEY or OPENAI_BILLING_API_KEY set; skipping")
        return 0

    warn_usd = float(os.getenv("BUDGET_WARN_THRESHOLD_USD", "8"))
    hard_cap_usd = float(os.getenv("BUDGET_HARD_CAP_USD", "10"))
    enforcement_mode = os.getenv("BUDGET_ENFORCEMENT_MODE", "enforce").strip().lower()
    now = dt.datetime.now(dt.timezone.utc)
    start_ts, end_ts, month_key, month_start = month_window_utc(now)

    try:
        monthly_cost = fetch_cost_usd(api_key, start_ts, end_ts)
    except Exception as exc:
        log(f"Failed to read billing usage: {exc}")
        return 0

    if monthly_cost is None:
        return 0

    log(f"Monthly OpenAI cost since {month_start} UTC: ${monthly_cost:.4f}")

    lock_state = read_lock()
    if lock_state and lock_state.get("month") != month_key:
        # New month: clear stale lock and resume service.
        clear_lock()
        run_compose("up", "-d", "openclaw-gateway")
        log("New month detected; cleared stale budget lock and ensured gateway is running")

    if monthly_cost >= hard_cap_usd:
        write_lock(month_key, monthly_cost, hard_cap_usd)
        if enforcement_mode == "enforce":
            run_compose("stop", "openclaw-gateway")
            log(f"Hard cap reached (${hard_cap_usd:.2f}); gateway stopped")
        else:
            log(f"Hard cap reached (${hard_cap_usd:.2f}); advisory mode, no stop action taken")
        return 0

    if monthly_cost >= warn_usd:
        log(f"Warning threshold reached (${warn_usd:.2f})")

    if LOCK_FILE.exists():
        clear_lock()
        run_compose("up", "-d", "openclaw-gateway")
        log("Budget below cap; lock cleared and gateway started")

    return 0


if __name__ == "__main__":
    sys.exit(main())
