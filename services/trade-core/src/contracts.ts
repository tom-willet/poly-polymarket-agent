export interface EventEnvelope<T> {
  schema_version: "v1";
  env: "sim" | "paper" | "prod";
  event_type: string;
  service: "trade-core";
  trace_id: string;
  ts_utc: string;
  payload: T;
}

export interface StrategyProposalContract {
  market_id: string;
  contract_id: string;
  side: "buy" | "sell";
}

export interface StrategyProposalPayload {
  proposal_id: string;
  sleeve_id: string;
  market_complex_id: string;
  thesis?: string;
  contracts: StrategyProposalContract[];
  expected_edge_after_costs: number;
  confidence: number;
  max_holding_hours: number;
  invalidators: string[];
  sizing_hint_usd?: number;
  notes?: string;
}

export interface AllocatorDecisionPayload {
  decision_id: string;
  proposal_id: string;
  sleeve_id: string;
  rank: number;
  requested_notional_usd: number;
  allocated_notional_usd: number;
  status: "forwarded_to_risk" | "rejected";
  reason: string;
}

export interface RiskCheckPayload {
  name: string;
  result: "pass" | "fail";
}

export interface RiskDecisionPayload {
  decision_id: string;
  proposal_id: string;
  status: "approved" | "resized" | "rejected" | "halted";
  approved_notional_usd: number;
  checks: RiskCheckPayload[];
  reason: string;
}

export interface ExecutionIntentLegPayload {
  market_id: string;
  contract_id: string;
  side: "buy" | "sell";
  limit_price: number;
  max_size: number;
}

export interface ExecutionIntentPayload {
  order_plan_id: string;
  decision_id: string;
  sleeve_id: string;
  market_complex_id: string;
  execution_style: "passive_then_cross" | "cross_only";
  max_notional_usd: number;
  legs: ExecutionIntentLegPayload[];
  expiry_utc: string;
  cancel_if_unfilled: boolean;
}

export interface ExecutionActionLegPayload {
  market_id: string;
  contract_id: string;
  side: "buy" | "sell";
  action: "place_passive" | "place_cross" | "cancel";
  order_id?: string;
  limit_price: number | null;
  size: number;
}

export interface ExecutionActionPayload {
  order_plan_id: string;
  decision_id: string;
  status: "ready" | "waiting" | "cancel_requested" | "completed" | "halted";
  reason: string;
  actions: ExecutionActionLegPayload[];
}

export interface OrderEventPayload {
  order_plan_id: string;
  order_id: string;
  market_id: string;
  contract_id: string;
  status: "placed" | "partially_filled" | "filled" | "cancelled" | "trade_update";
  side: "buy" | "sell";
  limit_price: number | null;
  filled_size: number;
  remaining_size: number;
  event_ts_utc: string;
}
