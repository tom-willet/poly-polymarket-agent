export interface EventEnvelope<T> {
  schema_version: "v1";
  env: "sim" | "paper" | "prod";
  event_type: string;
  service: "openclaw-control";
  trace_id: string;
  ts_utc: string;
  payload: T;
}

export interface OperatorCommandPayload {
  command_id: string;
  user_id: string;
  channel_id: string;
  command: "status" | "paper" | "orders" | "fills" | "pnl" | "why" | "risk" | "pause" | "resume" | "flatten" | "mode" | "sleeves";
  args?: string[];
}

export interface OperatorStatePayload {
  mode: "sim" | "paper" | "prod";
  paused: boolean;
  flatten_requested: boolean;
  updated_by: string;
  updated_at_utc: string;
}

export interface OperatorNotificationPayload {
  command_id: string;
  command: OperatorCommandPayload["command"];
  summary: string;
  details: string[];
}

export interface StrategyProposalLegPayload {
  market_id: string;
  contract_id: string;
  side: "buy" | "sell";
}

export interface StrategyProposalPayload {
  proposal_id: string;
  sleeve_id: string;
  market_complex_id: string;
  thesis: string;
  contracts: StrategyProposalLegPayload[];
  expected_edge_after_costs: number;
  confidence: number;
  max_holding_hours: number;
  invalidators: string[];
  sizing_hint_usd: number;
  notes: string;
}

export interface DecisionCyclePayload {
  proposal_count: number;
  allocator_decision_count: number;
  risk_decision_count: number;
  execution_intent_count: number;
  notes: string[];
  proposals: StrategyProposalPayload[];
  allocator_decisions: unknown[];
  risk_decisions: unknown[];
  execution_intents: unknown[];
}
