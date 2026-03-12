# Nonprod Observation Checklist

Status: live as of March 10, 2026

This is the recommended observation loop now that the nonprod services are continuously running.

## Why Observe First

- The current unknowns are runtime stability, stale-state behavior, restart behavior, and real-world opportunity flow.
- These are not build-time problems anymore. They only show up after the system runs for hours.

## Daily Checks

### 1. AWS Spend

Use the one-off CLI report:

```bash
AWS_PROFILE=mullet-dev python3 scripts/nonprod/report_aws_monthly_costs.py
```

Recommended baseline:

- Track month-to-date account cost
- Track yesterday cost
- Track projected month total
- Track top AWS services by spend

The optional Terraform daily cost email report uses the same account-level Cost Explorer inputs.

Current nonprod automation:

- daily AWS cost email at 7:00 AM America/Denver
- daily runtime health digest at 7:15 AM America/Denver
- both emails use the same SNS email subscription configured by `daily_cost_report_email`

### 2. Runtime Freshness

Check:

- `health#market-data`
- account `snapshot` and `health` rows
- `health#execution-heartbeat`

Things to watch:

- stale market data
- missing or delayed account refreshes
- unexpected execution heartbeat gaps

### 3. Operator Visibility

High-value commands:

- `status`
- `markets`
- `why`
- `scorecard`

### 4. ECS and Logs

Watch for:

- task restarts
- deployment churn
- repeated reconnect loops
- unexpected exceptions in CloudWatch logs

## Current Gaps Worth Watching

- `position_snapshot` still needs verification with a non-empty account.
- Cost visibility is account-level, not yet project-tag-level.

## Recommended Next Observation Upgrade

The next most useful additions after the live cost and health emails are:

- project-level AWS cost allocation tags so spend is not mixed with unrelated account usage
- `position_snapshot` verification with a non-empty account
- a richer daily digest that includes restart deltas and scorecard-style execution summaries
