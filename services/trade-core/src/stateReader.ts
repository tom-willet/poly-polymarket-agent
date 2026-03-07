import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { AllocatorDecisionPayload, RiskDecisionPayload, StrategyProposalPayload } from "./contracts.js";
import type { ExecutionMarketState, ExecutionPlanningInput } from "./execution.js";
import type { PerformanceState, RiskEvaluationInput, RiskMarketState, SystemHealthState, OperatorState } from "./risk.js";

interface CurrentStateItem<T> {
  payload: T;
}

interface MarketSnapshotPayload {
  market_id: string;
  contract_id: string;
  spread_cents: number | null;
  best_bid: number | null;
  best_ask: number | null;
  top_bid_size: number | null;
  top_ask_size: number | null;
  time_to_resolution_hours: number | null;
}

interface MarketDataHealthPayload {
  stale: boolean;
}

interface AccountStateHealthPayload {
  stale: boolean;
  reconciliation_ok: boolean;
}

interface AccountStateSnapshotPayload {
  user_address: string;
  collateral: {
    balance: number;
    allowance: number;
  };
}

export interface CurrentStateReader {
  get<T>(pk: string, sk: string): Promise<CurrentStateItem<T> | null>;
}

export class DynamoDbCurrentStateReader implements CurrentStateReader {
  private readonly documentClient: DynamoDBDocumentClient;

  constructor(private readonly tableName: string) {
    this.documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async get<T>(pk: string, sk: string): Promise<CurrentStateItem<T> | null> {
    const response = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk }
      })
    );

    if (!response.Item) {
      return null;
    }

    return response.Item as CurrentStateItem<T>;
  }
}

export function loadCurrentStateReaderFromEnv(): CurrentStateReader {
  const tableName = process.env.STATE_CURRENT_TABLE;
  if (!tableName) {
    throw new Error("STATE_CURRENT_TABLE is required for current-state reads");
  }

  return new DynamoDbCurrentStateReader(tableName);
}

export interface CanonicalStateBundle {
  marketState: RiskMarketState[];
  executionMarketState: ExecutionMarketState[];
  systemHealth: Omit<SystemHealthState, "executionHeartbeatHealthy">;
  accountUserAddress: string;
}

export interface AssembleRiskInputOptions {
  allocatorDecision: AllocatorDecisionPayload;
  proposal: StrategyProposalPayload;
  accountUserAddress: string;
  operatorState: OperatorState;
  performance: PerformanceState;
  estimatedTotalCostsUsd?: number;
  executionHeartbeatHealthy: boolean;
}

export async function loadCanonicalStateBundle(
  reader: CurrentStateReader,
  proposal: StrategyProposalPayload,
  accountUserAddress: string
): Promise<CanonicalStateBundle> {
  const marketSnapshots = await Promise.all(
    proposal.contracts.map(async (contract) => {
      const item = await reader.get<MarketSnapshotPayload>(`market#${contract.contract_id}`, "snapshot");
      if (!item) {
        throw new Error(`Missing market snapshot for contract ${contract.contract_id}`);
      }
      return item.payload;
    })
  );

  const marketHealth = await reader.get<MarketDataHealthPayload>("health#market-data", "latest");
  if (!marketHealth) {
    throw new Error("Missing market data health snapshot");
  }

  const accountHealth = await reader.get<AccountStateHealthPayload>(`account#${accountUserAddress}`, "health");
  if (!accountHealth) {
    throw new Error(`Missing account health snapshot for ${accountUserAddress}`);
  }

  const accountSnapshot = await reader.get<AccountStateSnapshotPayload>(`account#${accountUserAddress}`, "snapshot");
  if (!accountSnapshot) {
    throw new Error(`Missing account snapshot for ${accountUserAddress}`);
  }

  return {
    marketState: marketSnapshots.map((snapshot) => ({
      market_id: snapshot.market_id,
      contract_id: snapshot.contract_id,
      spread_cents: snapshot.spread_cents,
      top_bid_size: snapshot.top_bid_size,
      top_ask_size: snapshot.top_ask_size,
      time_to_resolution_hours: snapshot.time_to_resolution_hours
    })),
    executionMarketState: marketSnapshots.map((snapshot) => ({
      market_id: snapshot.market_id,
      contract_id: snapshot.contract_id,
      best_bid: snapshot.best_bid,
      best_ask: snapshot.best_ask,
      spread_cents: snapshot.spread_cents
    })),
    systemHealth: {
      marketDataStale: marketHealth.payload.stale,
      accountStateStale: accountHealth.payload.stale,
      accountReconciliationOk: accountHealth.payload.reconciliation_ok,
      walletBalanceMatches:
        accountSnapshot.payload.collateral.balance >= 0 &&
        accountSnapshot.payload.collateral.allowance >= 0
    },
    accountUserAddress
  };
}

export async function assembleRiskInputFromState(
  reader: CurrentStateReader,
  options: AssembleRiskInputOptions
): Promise<RiskEvaluationInput> {
  const bundle = await loadCanonicalStateBundle(reader, options.proposal, options.accountUserAddress);
  return {
    allocatorDecision: options.allocatorDecision,
    proposal: options.proposal,
    marketState: bundle.marketState,
    systemHealth: {
      ...bundle.systemHealth,
      executionHeartbeatHealthy: options.executionHeartbeatHealthy
    },
    operatorState: options.operatorState,
    performance: options.performance,
    estimatedTotalCostsUsd: options.estimatedTotalCostsUsd
  };
}

export async function assembleExecutionPlanningInputFromState(
  reader: CurrentStateReader,
  options: {
    allocatorDecision: AllocatorDecisionPayload;
    proposal: StrategyProposalPayload;
    accountUserAddress: string;
    riskDecision: RiskDecisionPayload & {
      status: "approved" | "resized";
    };
  }
): Promise<ExecutionPlanningInput> {
  const bundle = await loadCanonicalStateBundle(reader, options.proposal, options.accountUserAddress);
  return {
    allocatorDecision: options.allocatorDecision,
    riskDecision: options.riskDecision,
    proposal: options.proposal,
    marketState: bundle.executionMarketState
  };
}
