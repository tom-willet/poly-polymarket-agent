import type { AllocatorConfig } from "./config.js";
import type { AllocatorDecisionPayload, EventEnvelope, StrategyProposalPayload } from "./contracts.js";
import { validateProposal, type NormalizedStrategyProposal } from "./proposals.js";

export interface ExposureState {
  grossReservedUsd: number;
  sleeveReservedUsd: Record<string, number>;
  marketComplexReservedUsd: Record<string, number>;
  contractReservedUsd: Record<string, number>;
}

export interface AllocationContext {
  config: AllocatorConfig;
  exposure: ExposureState;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(2));
}

function buildDecision(
  env: AllocatorConfig["env"],
  payload: AllocatorDecisionPayload
): EventEnvelope<AllocatorDecisionPayload> {
  return {
    schema_version: "v1",
    env,
    event_type: "allocator_decision",
    service: "trade-core",
    trace_id: crypto.randomUUID(),
    ts_utc: new Date().toISOString(),
    payload
  };
}

function requestedNotional(proposal: NormalizedStrategyProposal, config: AllocatorConfig): number {
  if (proposal.requested_notional_usd > 0) {
    return roundUsd(proposal.requested_notional_usd);
  }

  return roundUsd(config.bankrollUsd * config.maxInitialOrderSliceRatio);
}

function proposalScore(proposal: NormalizedStrategyProposal, exposure: ExposureState, config: AllocatorConfig): number {
  const sleeveUtilization = (exposure.sleeveReservedUsd[proposal.sleeve_id] ?? 0) / (config.bankrollUsd * config.maxSleeveExposureRatio);
  const complexUtilization =
    (exposure.marketComplexReservedUsd[proposal.market_complex_id] ?? 0) /
    (config.bankrollUsd * config.maxMarketComplexExposureRatio);
  const activeSleevePenalty = exposure.sleeveReservedUsd[proposal.sleeve_id] ? 1 : 0.95;
  const holdingPenalty = 1 / Math.max(1, proposal.max_holding_hours / 24);
  const portfolioFit = Math.max(0.1, 1 - sleeveUtilization * 0.5 - complexUtilization * 0.5);

  return proposal.expected_edge_after_costs * proposal.confidence * activeSleevePenalty * holdingPenalty * portfolioFit;
}

function countActiveSleeves(exposure: ExposureState): number {
  return Object.values(exposure.sleeveReservedUsd).filter((value) => value > 0).length;
}

function allocationCapacity(proposal: NormalizedStrategyProposal, context: AllocationContext): { capacityUsd: number; reason?: string } {
  const { config, exposure } = context;
  const activeSleeves = countActiveSleeves(exposure);
  const isExistingSleeve = (exposure.sleeveReservedUsd[proposal.sleeve_id] ?? 0) > 0;
  if (!isExistingSleeve && activeSleeves >= config.maxActiveSleeves) {
    return {
      capacityUsd: 0,
      reason: `active sleeve limit reached (${config.maxActiveSleeves})`
    };
  }

  const globalCap = config.bankrollUsd * config.maxGrossExposureRatio - exposure.grossReservedUsd;
  const sleeveCap =
    config.bankrollUsd * config.maxSleeveExposureRatio - (exposure.sleeveReservedUsd[proposal.sleeve_id] ?? 0);
  const complexCap =
    config.bankrollUsd * config.maxMarketComplexExposureRatio -
    (exposure.marketComplexReservedUsd[proposal.market_complex_id] ?? 0);
  const contractCap = Math.min(
    ...proposal.contracts.map(
      (contract) =>
        config.bankrollUsd * config.maxContractExposureRatio -
        (exposure.contractReservedUsd[contract.contract_id] ?? 0)
    )
  );
  const initialSliceCap = config.bankrollUsd * config.maxInitialOrderSliceRatio;

  const capacityUsd = roundUsd(Math.max(0, Math.min(globalCap, sleeveCap, complexCap, contractCap, initialSliceCap)));
  if (capacityUsd <= 0) {
    return {
      capacityUsd: 0,
      reason: "no allocator capacity remains under bankroll limits"
    };
  }

  return { capacityUsd };
}

function reserveExposure(proposal: NormalizedStrategyProposal, allocatedUsd: number, exposure: ExposureState): void {
  exposure.grossReservedUsd = roundUsd(exposure.grossReservedUsd + allocatedUsd);
  exposure.sleeveReservedUsd[proposal.sleeve_id] = roundUsd(
    (exposure.sleeveReservedUsd[proposal.sleeve_id] ?? 0) + allocatedUsd
  );
  exposure.marketComplexReservedUsd[proposal.market_complex_id] = roundUsd(
    (exposure.marketComplexReservedUsd[proposal.market_complex_id] ?? 0) + allocatedUsd
  );
  const perContractAllocation = roundUsd(allocatedUsd / proposal.contracts.length);
  for (const contract of proposal.contracts) {
    exposure.contractReservedUsd[contract.contract_id] = roundUsd(
      (exposure.contractReservedUsd[contract.contract_id] ?? 0) + perContractAllocation
    );
  }
}

export function allocateProposals(
  proposals: StrategyProposalPayload[],
  context: AllocationContext
): EventEnvelope<AllocatorDecisionPayload>[] {
  const rejections: EventEnvelope<AllocatorDecisionPayload>[] = [];
  const normalized: NormalizedStrategyProposal[] = [];

  for (const proposal of proposals) {
    const validation = validateProposal(proposal);
    if (!validation.proposal) {
      rejections.push(
        buildDecision(context.config.env, {
          decision_id: crypto.randomUUID(),
          proposal_id: proposal.proposal_id || "unknown",
          sleeve_id: proposal.sleeve_id || "unknown",
          rank: 0,
          requested_notional_usd: roundUsd(proposal.sizing_hint_usd ?? 0),
          allocated_notional_usd: 0,
          status: "rejected",
          reason: validation.errors.join("; ")
        })
      );
      continue;
    }

    normalized.push(validation.proposal);
  }

  normalized.sort((left, right) => proposalScore(right, context.exposure, context.config) - proposalScore(left, context.exposure, context.config));

  const decisions: EventEnvelope<AllocatorDecisionPayload>[] = [];
  normalized.forEach((proposal, index) => {
    const requestedUsd = requestedNotional(proposal, context.config);
    const capacity = allocationCapacity(proposal, context);
    if (capacity.capacityUsd <= 0) {
      decisions.push(
        buildDecision(context.config.env, {
          decision_id: crypto.randomUUID(),
          proposal_id: proposal.proposal_id,
          sleeve_id: proposal.sleeve_id,
          rank: index + 1,
          requested_notional_usd: requestedUsd,
          allocated_notional_usd: 0,
          status: "rejected",
          reason: capacity.reason ?? "allocator capacity unavailable"
        })
      );
      return;
    }

    const allocatedUsd = roundUsd(Math.min(requestedUsd, capacity.capacityUsd));
    reserveExposure(proposal, allocatedUsd, context.exposure);
    decisions.push(
      buildDecision(context.config.env, {
        decision_id: crypto.randomUUID(),
        proposal_id: proposal.proposal_id,
        sleeve_id: proposal.sleeve_id,
        rank: index + 1,
        requested_notional_usd: requestedUsd,
        allocated_notional_usd: allocatedUsd,
        status: "forwarded_to_risk",
        reason:
          allocatedUsd < requestedUsd
            ? "resized to fit allocator bankroll limits"
            : "ranked and funded under allocator bankroll limits"
      })
    );
  });

  return [...rejections, ...decisions];
}
