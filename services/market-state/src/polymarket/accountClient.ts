import {
  AssetType,
  Chain,
  ClobClient,
  SignatureType,
  type ApiKeyCreds,
  type BalanceAllowanceResponse,
  type OpenOrder,
  type Trade
} from "@polymarket/clob-client";
import { Wallet } from "ethers";
import type {
  AccountBalanceRecord,
  AccountOpenOrderRecord,
  AccountPositionRecord,
  AccountTradeRecord
} from "../contracts.js";
import type { AccountStateSnapshotPayload } from "../accountSnapshot.js";
import type { AppConfig } from "../config.js";
import type { DataApiPosition } from "./accountTypes.js";

function parseNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: boolean | string | number | null | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true" || value === "1";
  }
  return false;
}

function parseTimestamp(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    const tsMs = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(tsMs).toISOString();
  }

  if (/^\d+$/.test(value)) {
    const numeric = Number.parseInt(value, 10);
    const tsMs = value.length > 10 ? numeric : numeric * 1000;
    return new Date(tsMs).toISOString();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function toChain(chainId: number): Chain {
  if (chainId === Chain.POLYGON) {
    return Chain.POLYGON;
  }
  if (chainId === Chain.AMOY) {
    return Chain.AMOY;
  }
  throw new Error(`Unsupported POLY_CHAIN_ID "${chainId}"`);
}

function toSignatureType(signatureType: number): SignatureType {
  if (signatureType === SignatureType.EOA) {
    return SignatureType.EOA;
  }
  if (signatureType === SignatureType.POLY_PROXY) {
    return SignatureType.POLY_PROXY;
  }
  if (signatureType === SignatureType.POLY_GNOSIS_SAFE) {
    return SignatureType.POLY_GNOSIS_SAFE;
  }
  throw new Error(`Unsupported POLY_SIGNATURE_TYPE "${signatureType}"`);
}

function normalizeCollateral(balance: BalanceAllowanceResponse): AccountBalanceRecord {
  return {
    asset_type: "COLLATERAL",
    token_id: null,
    balance: parseNumber(balance.balance),
    allowance: parseNumber(balance.allowance)
  };
}

function normalizeOpenOrder(order: OpenOrder): AccountOpenOrderRecord {
  const originalSize = parseNumber(order.original_size);
  const matchedSize = parseNumber(order.size_matched);
  const remainingSize =
    originalSize === null || matchedSize === null ? null : Number((originalSize - matchedSize).toFixed(6));

  return {
    order_id: order.id,
    market_id: order.market,
    contract_id: order.asset_id,
    side: order.side,
    status: order.status,
    price: parseNumber(order.price),
    original_size: originalSize,
    matched_size: matchedSize,
    remaining_size: remainingSize,
    outcome: order.outcome ?? null,
    created_at_utc: parseTimestamp(order.created_at),
    expiration_utc: parseTimestamp(order.expiration)
  };
}

function normalizeTrade(trade: Trade): AccountTradeRecord {
  return {
    trade_id: trade.id,
    market_id: trade.market,
    contract_id: trade.asset_id,
    side: trade.side,
    price: parseNumber(trade.price),
    size: parseNumber(trade.size),
    status: trade.status,
    outcome: trade.outcome ?? null,
    match_time_utc: parseTimestamp(trade.match_time),
    last_update_utc: parseTimestamp(trade.last_update),
    trader_side: trade.trader_side ?? null,
    transaction_hash: trade.transaction_hash ?? null
  };
}

function normalizePosition(position: DataApiPosition): AccountPositionRecord {
  return {
    market_id: position.market ?? null,
    contract_id: position.asset ?? "",
    condition_id: position.conditionId ?? null,
    outcome: position.outcome ?? null,
    size: parseNumber(position.size),
    avg_price: parseNumber(position.avgPrice),
    current_price: parseNumber(position.curPrice),
    current_value_usd: parseNumber(position.currentValue),
    cash_pnl_usd: parseNumber(position.cashPnl),
    redeemable: parseBoolean(position.redeemable),
    title: position.title ?? null,
    slug: position.slug ?? null,
    event_slug: position.eventSlug ?? null,
    end_date_utc: parseTimestamp(position.endDate)
  };
}

export class PolymarketAccountClient {
  constructor(private readonly config: AppConfig) {}

  async fetchAccountSnapshot(): Promise<AccountStateSnapshotPayload> {
    if (!this.config.polyUserAddress) {
      throw new Error("Account polling requires POLY_USER_ADDRESS");
    }

    const clobClient = await this.createAuthenticatedClient();
    const [collateralBalance, openOrders, recentTrades, positions] = await Promise.all([
      clobClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL }),
      clobClient.getOpenOrders(),
      clobClient.getTrades({ maker_address: this.config.polyFunderAddress ?? this.config.polyUserAddress }, true),
      this.fetchPositions()
    ]);

    const normalizedCollateral = normalizeCollateral(collateralBalance);
    const normalizedOrders = openOrders.map(normalizeOpenOrder);
    const normalizedTrades = recentTrades.map(normalizeTrade);
    const normalizedPositions = positions.map(normalizePosition).filter((position) => position.contract_id !== "");
    const totalPositionValue = normalizedPositions.reduce<number | null>((sum, position) => {
      if (position.current_value_usd === null) {
        return sum;
      }
      return (sum ?? 0) + position.current_value_usd;
    }, 0);

    return {
      user_address: this.config.polyUserAddress,
      funder_address: this.config.polyFunderAddress ?? this.config.polyUserAddress,
      collateral: normalizedCollateral,
      open_order_count: normalizedOrders.length,
      position_count: normalizedPositions.length,
      recent_trade_count: normalizedTrades.length,
      total_position_value_usd: totalPositionValue,
      open_orders: normalizedOrders,
      positions: normalizedPositions,
      recent_trades: normalizedTrades
    };
  }

  private async createAuthenticatedClient(): Promise<ClobClient> {
    const chain = toChain(this.config.polyChainId);
    const signatureType = toSignatureType(this.config.polySignatureType);
    const signer = this.config.polyPrivateKey ? new Wallet(this.config.polyPrivateKey) : undefined;
    let creds: ApiKeyCreds | undefined = this.config.polyClobApiKey
      ? (() => {
          if (!this.config.polyClobApiSecret || !this.config.polyClobApiPassphrase) {
            throw new Error(
              "POLY_CLOB_API_KEY requires POLY_CLOB_API_SECRET and POLY_CLOB_API_PASSPHRASE"
            );
          }

          return {
            key: this.config.polyClobApiKey,
            secret: this.config.polyClobApiSecret,
            passphrase: this.config.polyClobApiPassphrase
          };
        })()
      : undefined;

    if (!creds) {
      if (!signer) {
        throw new Error(
          "Account polling requires either POLY_PRIVATE_KEY or POLY_CLOB_API_KEY/POLY_CLOB_API_SECRET/POLY_CLOB_API_PASSPHRASE"
        );
      }

      const bootstrapClient = new ClobClient(
        this.config.polyClobBaseUrl,
        chain,
        signer,
        undefined,
        signatureType,
        this.config.polyFunderAddress
      );
      creds = await bootstrapClient.createOrDeriveApiKey();
    }

    return new ClobClient(
      this.config.polyClobBaseUrl,
      chain,
      signer,
      creds,
      signatureType,
      this.config.polyFunderAddress
    );
  }

  private async fetchPositions(): Promise<DataApiPosition[]> {
    const url = new URL("/positions", this.config.polyDataBaseUrl);
    url.searchParams.set("user", this.config.polyUserAddress);
    url.searchParams.set("sizeThreshold", String(this.config.polyPositionsSizeThreshold));
    url.searchParams.set("limit", String(this.config.polyPositionsLimit));
    url.searchParams.set("offset", "0");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Positions request failed with status ${response.status}`);
    }

    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) {
      throw new Error("Positions response was not an array");
    }

    return body as DataApiPosition[];
  }
}
