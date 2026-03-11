from __future__ import annotations

import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Attr


def scan_all(table, filter_expression) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    kwargs = {"FilterExpression": filter_expression}

    while True:
        response = table.scan(**kwargs)
        items.extend(response.get("Items", []))
        last_evaluated_key = response.get("LastEvaluatedKey")
        if not last_evaluated_key:
            return items
        kwargs["ExclusiveStartKey"] = last_evaluated_key


def short_account_id(value: str) -> str:
    if len(value) <= 16:
        return value
    return f"{value[:10]}...{value[-6:]}"


def handler(event: dict[str, object], _context: object) -> dict[str, object]:
    del event

    current_state_table_name = os.environ["CURRENT_STATE_TABLE"]
    decision_ledger_table_name = os.environ["DECISION_LEDGER_TABLE"]
    cluster_name = os.environ["ECS_CLUSTER_NAME"]
    project_name = os.environ.get("PROJECT_NAME", "poly-orchestrator")
    environment_name = os.environ.get("ENVIRONMENT_NAME", "nonprod")
    service_names = [name for name in os.environ.get("SERVICE_NAMES", "").split(",") if name]
    topic_arn = os.environ["SNS_TOPIC_ARN"]

    now = datetime.now(timezone.utc)

    dynamodb = boto3.resource("dynamodb")
    ecs = boto3.client("ecs")
    sns = boto3.client("sns")

    current_state = dynamodb.Table(current_state_table_name)
    decision_ledger = dynamodb.Table(decision_ledger_table_name)

    services_response = ecs.describe_services(cluster=cluster_name, services=service_names)
    service_lines: list[str] = []
    for service in services_response.get("services", []):
        deployments = service.get("deployments", [])
        primary = next((item for item in deployments if item.get("status") == "PRIMARY"), None)
        rollout = primary.get("rolloutState", "n/a") if primary else "n/a"
        service_lines.append(
            f"- {service['serviceName']}: running={service['runningCount']}/{service['desiredCount']} pending={service['pendingCount']} rollout={rollout}"
        )

    market_health = current_state.get_item(Key={"pk": "health#market-data", "sk": "latest"}).get("Item")
    heartbeat = current_state.get_item(Key={"pk": "health#execution-heartbeat", "sk": "latest"}).get("Item")
    account_rows = scan_all(current_state, Attr("pk").begins_with("account#") & Attr("sk").eq("health"))
    cycle_rows = scan_all(decision_ledger, Attr("pk").begins_with("decision_cycle#"))

    lines = [
        f"AWS daily health report for {project_name}/{environment_name}",
        f"Generated: {now.isoformat()}",
        "",
        "ECS services:",
    ]

    if service_lines:
        lines.extend(service_lines)
    else:
        lines.append("- no ECS services returned")

    lines.extend(["", "State health:"])

    if market_health:
        payload = market_health["payload"]
        lines.append(
            f"- market data: {'STALE' if payload['stale'] else 'fresh'} observed/tracked={payload['observed_contracts']}/{payload['tracked_contracts']} last_message={payload['last_message_ts_utc']}"
        )
    else:
        lines.append("- market data: missing")

    if heartbeat:
        payload = heartbeat["payload"]
        lines.append(
            f"- execution heartbeat: healthy={payload['healthy']} active={payload['active']} last_sent={payload['last_sent_ts_utc']} last_ack={payload['last_ack_ts_utc']}"
        )
    else:
        lines.append("- execution heartbeat: missing")

    if account_rows:
        for row in sorted(account_rows, key=lambda item: item["ts_utc"], reverse=True)[:5]:
            payload = row["payload"]
            issues = ", ".join(payload.get("issues", [])) if payload.get("issues") else "none"
            account_id = row["pk"].split("#", 1)[1]
            lines.append(
                f"- account {short_account_id(account_id)}: stale={payload['stale']} reconciliation_ok={payload['reconciliation_ok']} open_orders={payload['open_order_count']} positions={payload['position_count']} issues={issues}"
            )
    else:
        lines.append("- account health: no rows found")

    lines.extend(["", "Latest decision cycle:"])

    decision_cycles = [row for row in cycle_rows if row.get("event_type") == "decision_cycle"]
    if decision_cycles:
        latest_cycle = sorted(decision_cycles, key=lambda item: item["ts_utc"], reverse=True)[0]
        payload = latest_cycle["payload"]
        lines.append(
            f"- {latest_cycle['ts_utc']}: proposals={payload['proposal_count']} allocator={payload['allocator_decision_count']} risk={payload['risk_decision_count']} intents={payload['execution_intent_count']}"
        )
        for note in payload.get("notes", [])[:5]:
            lines.append(f"- note: {note}")
    else:
        lines.append("- no decision-cycle rows found")

    subject = f"[{project_name}/{environment_name}] AWS daily health report {now.date().isoformat()}"
    message = "\n".join(lines)

    sns.publish(TopicArn=topic_arn, Subject=subject, Message=message)

    return {
        "status": "ok",
        "subject": subject,
        "service_count": len(service_lines),
        "account_health_count": len(account_rows),
        "latest_cycle_found": bool(decision_cycles),
    }
