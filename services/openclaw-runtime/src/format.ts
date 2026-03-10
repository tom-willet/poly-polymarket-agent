import type {
  DecisionCyclePayload,
  EventEnvelope,
  OperatorNotificationPayload,
  StrategyProposalPayload
} from "@poly/openclaw-control";

function bullet(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

export function renderOperatorNotification(
  notification: EventEnvelope<OperatorNotificationPayload>
): string {
  return [notification.payload.summary, bullet(notification.payload.details)].filter(Boolean).join("\n");
}

export function renderDecisionCycle(cycle: EventEnvelope<DecisionCyclePayload>): string {
  const lines = [
    `Decision cycle complete`,
    `proposals=${cycle.payload.proposal_count}`,
    `allocator_decisions=${cycle.payload.allocator_decision_count}`,
    `risk_decisions=${cycle.payload.risk_decision_count}`,
    `execution_intents=${cycle.payload.execution_intent_count}`
  ];

  if (cycle.payload.notes.length > 0) {
    lines.push(...cycle.payload.notes.slice(0, 5).map((note) => `note: ${note}`));
  }

  return bullet(lines);
}

export function renderProposals(proposals: StrategyProposalPayload[]): string {
  if (proposals.length === 0) {
    return "No eligible proposals found.";
  }

  return [
    `Found ${proposals.length} proposal${proposals.length === 1 ? "" : "s"}.`,
    bullet(
      proposals.slice(0, 5).map((proposal) => {
        return `${proposal.market_complex_id} edge=${proposal.expected_edge_after_costs.toFixed(4)} confidence=${proposal.confidence.toFixed(3)} horizon=${proposal.max_holding_hours}h`;
      })
    )
  ].join("\n");
}

export function renderHelp(): string {
  return [
    "Supported commands:",
    bullet([
      "status",
      "paper",
      "orders",
      "fills",
      "pnl",
      "why",
      "risk",
      "pause",
      "resume",
      "flatten",
      "mode <sim|paper|prod>",
      "sleeves",
      "propose",
      "cycle"
    ])
  ].join("\n");
}
