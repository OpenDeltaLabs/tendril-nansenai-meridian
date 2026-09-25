/**
 * @tendril/connector-sdk — PREVIEW
 *
 * The interface a Tendril connector is written against. This package is not
 * published yet; it documents the contract so connector authors can see what a
 * connector looks like today. Names and shapes may change before release.
 *
 * A connector teaches Tendril about one external system — a protocol, a data
 * provider, a custodian. It declares what it can do (capabilities), what it
 * needs (config + secrets), and implements a small set of hooks. Tendril hosts
 * the connector and does everything around it: the ledger, pricing policy,
 * permissions, approvals, signing, the REST API and the agent.
 *
 * This preview covers **data connectors** (read-only: market data, analytics,
 * prices, agent research tools). Execution connectors — ones that build
 * transactions — follow the same model but always hand their output to
 * Tendril's propose → approve → sign pipeline; a connector never moves funds on
 * its own.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Tendril network id, e.g. `solana`, `base`, `ethereum`, `arbitrum`. */
export type NetworkId = string;

/** Base-unit integer amounts travel as decimal strings (never JS numbers). */
export type BaseUnits = string;

/** A registered asset as Tendril knows it. */
export interface AssetRef {
  /** Tendril asset id, e.g. `asset_usdc_base`. */
  id: string;
  symbol: string;
  networkId: NetworkId | null;
  /** Token contract / mint address; null for native gas assets. */
  contractAddress: string | null;
  /** Display only — money math is always in base units. */
  decimals: number;
}

export type ConnectorCategory =
  | 'data_provider'
  | 'dex'
  | 'dex_aggregator'
  | 'lending_protocol'
  | 'bridge'
  | 'custody'
  | 'rpc_provider';

/**
 * A capability is a typed promise a connector makes, scoped to where it applies.
 * Tendril resolves connectors by capability + scope — never by name — so two
 * connectors offering `data.market` on `base` are interchangeable to callers.
 */
export interface CapabilityDeclaration {
  type:
    | 'data.market' // prices, market caps, liquidity
    | 'data.smart_money' // labelled-wallet holdings and flows
    | 'data.token_screener'
    | 'data.token_holders'
    | 'data.yields'
    | (string & {});
  scope: { chains?: NetworkId[]; [dimension: string]: unknown };
}

/** A secret the connector needs at runtime. Values never live in config. */
export interface SecretDeclaration {
  name: string;
  description: string;
  required: boolean;
}

// ---------------------------------------------------------------------------
// Runtime context — what Tendril hands a connector on every call
// ---------------------------------------------------------------------------

export interface ConnectorContext<Config> {
  /** Validated instance config (from `configSchema`). */
  config: Config;
  /** Secret values, resolved by Tendril at call time. */
  secrets: { get(name: string): string | undefined };
  /** Read access to Tendril's asset registry. */
  assets: AssetDirectory;
  /** Egress-controlled fetch (timeouts, allow-listed hosts, metering). */
  fetch: typeof fetch;
  logger: { info(msg: string, data?: object): void; warn(msg: string, data?: object): void };
  now(): Date;
}

export interface AssetDirectory {
  /** The registered asset for an on-chain token, or null if Tendril doesn't know it yet. */
  findByContract(network: NetworkId, contractAddress: string): Promise<AssetRef | null>;
  get(assetId: string): Promise<AssetRef | null>;
}

/**
 * Thrown by a connector to map an upstream failure onto a clean API error.
 * `upstream_error` → 502, `rate_limited` → 429, `invalid_input` → 400.
 */
export class ConnectorError extends Error {
  constructor(
    readonly code: 'upstream_error' | 'rate_limited' | 'invalid_input' | 'not_configured',
    message: string,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Minimal structural schema contract (satisfied by Zod, Valibot, …). */
export interface Schema<T> {
  parse(input: unknown): T;
}

/**
 * A read-only data route. Tendril mounts it on its REST API under
 * `GET /v1/connectors/{kind}/{path}`, generates the OpenAPI entry from the
 * schemas, and applies authentication, org scoping and rate limits.
 */
export interface DataRoute<Config, In, Out> {
  id: string;
  path: string;
  summary: string;
  description: string;
  input: Schema<In>;
  output: Schema<Out>;
  handler(ctx: ConnectorContext<Config>, input: In): Promise<Out>;
}

/**
 * A price source. Plugged into Tendril's pricing policy next to the built-in
 * sources; Tendril decides fallback order, staleness and persistence.
 */
export interface PriceSourceDefinition<Config> {
  id: string;
  /** `network_specific` sources price a token on one chain; `index` sources price a currency. */
  kind: 'network_specific' | 'index';
  supports(asset: AssetRef, quote: AssetRef): boolean;
  fetchPrice(
    ctx: ConnectorContext<Config>,
    asset: AssetRef,
    quote: AssetRef,
  ): Promise<PriceObservation | null>;
  fetchHistorical?(
    ctx: ConnectorContext<Config>,
    asset: AssetRef,
    quote: AssetRef,
    range: { from: Date; to: Date; interval: '1h' | '1d' },
  ): Promise<PriceObservation[]>;
  /** Registration-time probe: can this source price an asset Tendril is about to register? */
  canPrice?(ctx: ConnectorContext<Config>, identity: Omit<AssetRef, 'id' | 'decimals'>): Promise<boolean>;
}

export interface PriceObservation {
  assetId: string;
  quoteAssetId: string;
  /** Decimal string — prices are not money amounts and may have many decimals. */
  price: string;
  observedAt: Date;
  /** Extra market data stored alongside the price (market cap, liquidity, …). */
  metadata?: Record<string, unknown>;
}

/**
 * A tool the Tendril agent can call. Read-only tools may be called freely;
 * a tool can never move value — actions go through Tendril's intent pipeline,
 * which the operator approves.
 */
export interface AgentToolDefinition<Config> {
  name: string;
  /** Written for the model: when to use it, what comes back, caveats. */
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
  readOnly: true;
  handler(ctx: ConnectorContext<Config>, input: Record<string, unknown>): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// The connector
// ---------------------------------------------------------------------------

export interface ConnectorDefinition<Config> {
  /** Stable kind id, e.g. `nansen`. */
  kind: string;
  name: string;
  description: string;
  category: ConnectorCategory[];
  version: string;
  configSchema: Schema<Config>;
  secrets: SecretDeclaration[];
  /** Built from the instance config — capabilities can depend on it (e.g. chains in scope). */
  capabilities(config: Config): CapabilityDeclaration[];
  routes?: DataRoute<Config, any, any>[];
  priceSource?: PriceSourceDefinition<Config>;
  agentTools?: AgentToolDefinition<Config>[];
}

/** Identity helper that keeps full type inference for a connector definition. */
export function defineConnector<Config>(
  definition: ConnectorDefinition<Config>,
): ConnectorDefinition<Config> {
  return definition;
}
