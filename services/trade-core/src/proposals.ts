import type { StrategyProposalPayload } from "./contracts.js";

export interface NormalizedStrategyProposal extends StrategyProposalPayload {
  requested_notional_usd: number;
}

export interface ProposalValidationResult {
  proposal?: NormalizedStrategyProposal;
  errors: string[];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function validateProposal(input: StrategyProposalPayload): ProposalValidationResult {
  const errors: string[] = [];

  if (!input.proposal_id) {
    errors.push("proposal_id is required");
  }
  if (!input.sleeve_id) {
    errors.push("sleeve_id is required");
  }
  if (!input.market_complex_id) {
    errors.push("market_complex_id is required");
  }
  if (!Array.isArray(input.contracts) || input.contracts.length === 0) {
    errors.push("contracts must contain at least one leg");
  }
  if (!Number.isFinite(input.expected_edge_after_costs) || input.expected_edge_after_costs <= 0) {
    errors.push("expected_edge_after_costs must be positive");
  }
  if (!Number.isFinite(input.confidence) || input.confidence <= 0 || input.confidence > 1) {
    errors.push("confidence must be within (0, 1]");
  }
  if (!Number.isFinite(input.max_holding_hours) || input.max_holding_hours <= 0) {
    errors.push("max_holding_hours must be positive");
  }
  if (!Array.isArray(input.invalidators) || input.invalidators.length === 0) {
    errors.push("invalidators must contain at least one item");
  }

  const legKeys = unique(
    (input.contracts ?? []).map((contract) => `${contract.market_id}:${contract.contract_id}:${contract.side}`)
  );
  if (legKeys.length !== (input.contracts ?? []).length) {
    errors.push("contracts contain duplicate legs");
  }
  for (const contract of input.contracts ?? []) {
    if (!contract.market_id) {
      errors.push("each contract must include market_id");
    }
    if (!contract.contract_id) {
      errors.push("each contract must include contract_id");
    }
    if (!["buy", "sell"].includes(contract.side)) {
      errors.push("each contract side must be buy or sell");
    }
  }

  const requestedNotional = Number.isFinite(input.sizing_hint_usd) && (input.sizing_hint_usd ?? 0) > 0
    ? Number((input.sizing_hint_usd ?? 0).toFixed(2))
    : 0;

  if (errors.length > 0) {
    return { errors };
  }

  return {
    proposal: {
      ...input,
      requested_notional_usd: requestedNotional
    },
    errors: []
  };
}
