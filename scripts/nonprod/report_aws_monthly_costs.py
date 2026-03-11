#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import date, timedelta


def first_day_next_month(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def aws_json(args: list[str], profile: str | None, region: str) -> dict[str, object]:
    env = os.environ.copy()
    env["AWS_REGION"] = region
    if profile:
        env["AWS_PROFILE"] = profile

    result = subprocess.run(
        ["aws", *args, "--output", "json"],
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def metric_amount(metric: dict[str, object] | None) -> float:
    if not metric:
        return 0.0
    return float(metric.get("Amount", "0"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Print the current AWS monthly cost summary.")
    parser.add_argument("--profile", default=os.environ.get("AWS_PROFILE"))
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    parser.add_argument("--top-services", type=int, default=5)
    args = parser.parse_args()

    today = date.today()
    month_start = today.replace(day=1)
    tomorrow = today + timedelta(days=1)
    yesterday_start = today - timedelta(days=1)
    next_month = first_day_next_month(today)

    identity = aws_json(["sts", "get-caller-identity"], args.profile, args.region)
    account_id = identity.get("Account", "unknown")

    month_to_date = aws_json(
        [
            "ce",
            "get-cost-and-usage",
            "--time-period",
            f"Start={month_start.isoformat()},End={tomorrow.isoformat()}",
            "--granularity",
            "MONTHLY",
            "--metrics",
            "UnblendedCost",
        ],
        args.profile,
        args.region,
    )
    month_to_date_total = metric_amount(
        month_to_date["ResultsByTime"][0]["Total"].get("UnblendedCost")  # type: ignore[index]
    )

    yesterday = aws_json(
        [
            "ce",
            "get-cost-and-usage",
            "--time-period",
            f"Start={yesterday_start.isoformat()},End={today.isoformat()}",
            "--granularity",
            "DAILY",
            "--metrics",
            "UnblendedCost",
        ],
        args.profile,
        args.region,
    )
    yesterday_total = metric_amount(
        yesterday["ResultsByTime"][0]["Total"].get("UnblendedCost")  # type: ignore[index]
    )

    by_service = aws_json(
        [
            "ce",
            "get-cost-and-usage",
            "--time-period",
            f"Start={month_start.isoformat()},End={tomorrow.isoformat()}",
            "--granularity",
            "MONTHLY",
            "--metrics",
            "UnblendedCost",
            "--group-by",
            "Type=DIMENSION,Key=SERVICE",
        ],
        args.profile,
        args.region,
    )
    services = sorted(
        [
            (
                group["Keys"][0],  # type: ignore[index]
                metric_amount(group["Metrics"].get("UnblendedCost")),  # type: ignore[index]
            )
            for group in by_service["ResultsByTime"][0]["Groups"]  # type: ignore[index]
        ],
        key=lambda item: item[1],
        reverse=True,
    )

    remaining_forecast = aws_json(
        [
            "ce",
            "get-cost-forecast",
            "--time-period",
            f"Start={today.isoformat()},End={next_month.isoformat()}",
            "--metric",
            "UNBLENDED_COST",
            "--granularity",
            "MONTHLY",
        ],
        args.profile,
        args.region,
    )
    remaining_forecast_total = float(remaining_forecast["Total"]["Amount"])  # type: ignore[index]
    projected_month_total = month_to_date_total + remaining_forecast_total

    print(f"AWS account: {account_id}")
    print(f"Report date: {today.isoformat()}")
    print(f"Month-to-date unblended cost: ${month_to_date_total:.2f}")
    print(f"Yesterday unblended cost: ${yesterday_total:.2f}")
    print(f"Remaining-month forecast: ${remaining_forecast_total:.2f}")
    print(f"Projected month total: ${projected_month_total:.2f}")
    print()
    print("Top month-to-date services:")
    for name, amount in services[: args.top_services]:
        if amount <= 0:
            continue
        print(f"- {name}: ${amount:.2f}")
    print()
    print("Notes:")
    print("- Cost Explorer values are estimated and can lag by several hours.")
    print("- This output is account-level. Per-project allocation still requires cost-allocation tags or dedicated accounts.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
