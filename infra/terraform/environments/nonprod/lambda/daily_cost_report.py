from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone

import boto3


def first_day_next_month(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def metric_amount(metric: dict[str, object] | None) -> float:
    if not metric:
        return 0.0
    amount = metric.get("Amount", "0")
    return float(amount)


def handler(event: dict[str, object], _context: object) -> dict[str, object]:
    del event

    topic_arn = os.environ["SNS_TOPIC_ARN"]
    project_name = os.environ.get("PROJECT_NAME", "poly-orchestrator")
    environment_name = os.environ.get("ENVIRONMENT_NAME", "nonprod")
    account_id = os.environ.get("ACCOUNT_ID", "unknown")
    cost_region = os.environ.get("COST_EXPLORER_REGION", "us-east-1")

    now = datetime.now(timezone.utc)
    today = now.date()
    month_start = today.replace(day=1)
    tomorrow = today + timedelta(days=1)
    next_month = first_day_next_month(today)
    yesterday_start = today - timedelta(days=1)

    cost_explorer = boto3.client("ce", region_name=cost_region)
    sns = boto3.client("sns")

    month_to_date = cost_explorer.get_cost_and_usage(
        TimePeriod={"Start": month_start.isoformat(), "End": tomorrow.isoformat()},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
    )
    month_to_date_total = metric_amount(
        month_to_date["ResultsByTime"][0]["Total"].get("UnblendedCost")
    )

    yesterday = cost_explorer.get_cost_and_usage(
        TimePeriod={"Start": yesterday_start.isoformat(), "End": today.isoformat()},
        Granularity="DAILY",
        Metrics=["UnblendedCost"],
    )
    yesterday_total = metric_amount(
        yesterday["ResultsByTime"][0]["Total"].get("UnblendedCost")
    )

    by_service = cost_explorer.get_cost_and_usage(
        TimePeriod={"Start": month_start.isoformat(), "End": tomorrow.isoformat()},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
        GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
    )
    services = sorted(
        [
            {
                "name": group["Keys"][0],
                "amount": metric_amount(group["Metrics"].get("UnblendedCost")),
            }
            for group in by_service["ResultsByTime"][0]["Groups"]
        ],
        key=lambda service: service["amount"],
        reverse=True,
    )
    top_services = [service for service in services if service["amount"] > 0][:5]

    remaining_forecast = cost_explorer.get_cost_forecast(
        TimePeriod={"Start": today.isoformat(), "End": next_month.isoformat()},
        Metric="UNBLENDED_COST",
        Granularity="MONTHLY",
    )
    remaining_forecast_total = float(remaining_forecast["Total"]["Amount"])
    projected_month_total = month_to_date_total + remaining_forecast_total

    lines = [
        f"AWS daily cost report for {project_name}/{environment_name}",
        f"Account: {account_id}",
        f"Generated: {now.isoformat()}",
        "",
        f"Month-to-date unblended cost: ${month_to_date_total:.2f}",
        f"Yesterday unblended cost: ${yesterday_total:.2f}",
        f"Remaining-month forecast: ${remaining_forecast_total:.2f}",
        f"Projected month total: ${projected_month_total:.2f}",
        "",
        "Top month-to-date services:",
    ]

    if top_services:
        lines.extend(
            f"- {service['name']}: ${service['amount']:.2f}"
            for service in top_services
        )
    else:
        lines.append("- no non-zero service costs returned")

    lines.extend(
        [
            "",
            "Notes:",
            "- Cost Explorer values are estimated and can lag by several hours.",
            "- This report is account-level. Per-project allocation still requires cost-allocation tags or dedicated accounts.",
        ]
    )

    subject = f"[{project_name}/{environment_name}] AWS daily cost report {today.isoformat()}"
    message = "\n".join(lines)

    sns.publish(TopicArn=topic_arn, Subject=subject, Message=message)

    return {
        "status": "ok",
        "subject": subject,
        "month_to_date_unblended_cost_usd": round(month_to_date_total, 4),
        "yesterday_unblended_cost_usd": round(yesterday_total, 4),
        "remaining_forecast_usd": round(remaining_forecast_total, 4),
        "projected_month_total_usd": round(projected_month_total, 4),
        "top_services": top_services,
    }
