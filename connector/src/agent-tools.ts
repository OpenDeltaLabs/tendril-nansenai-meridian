import type { AgentToolDefinition, ConnectorContext } from '@tendril/connector-sdk';
import {
  smartMoneyHoldings,
  smartMoneyNetflow,
  tokenHolders,
  tokenInfo,
  tokenMarketData,
} from './routes.ts';
import type { NansenConfig } from './schemas.ts';
import { computeWeights } from './weights.ts';

/**
 * Tools the Tendril agent can call. All are read-only: they research and
 * compute. Anything that moves value (swaps, transfers, bridges, multisig
 * deployments) is proposed through Tendril's intent pipeline and approved and
 * signed by the operator — never executed by a tool.
 *
 * The descriptions are part of the product: they tell the model when to reach
 * for Nansen, what the fields mean, and which mistakes to avoid.
 */

type Tool = AgentToolDefinition<NansenConfig>;
type Ctx = ConnectorContext<NansenConfig>;

const CHAINS = {
  type: 'array',
  items: { type: 'string' },
  minItems: 1,
  maxItems: 5,
  description: 'Chains to screen as Tendril network ids: solana, base, ethereum, arbitrum, optimism, polygon.',
} as const;

const TOKEN = {
  chain: { type: 'string', description: 'Network id, e.g. `solana` or `base`.' },
  tokenAddress: { type: 'string', description: 'Token contract / mint address, exactly as returned.' },
} as const;

const run = <I, O>(route: { input: { parse(i: unknown): I }; handler(ctx: Ctx, i: I): Promise<O> }) =>
  (ctx: Ctx, input: Record<string, unknown>) => route.handler(ctx, route.input.parse(input));

export const agentTools: Tool[] = [
  {
    name: 'nansen_smart_money_holdings',
    readOnly: true,
    description:
      "Nansen smart money: the tokens Nansen's labelled smart-money wallets (top-performing traders " +
      'and funds) hold the most USD value in — a true top N PER CHAIN. Use it whenever the operator ' +
      'mentions Nansen, smart money, or "top coins / tokens" to pick. Each row: rank (per chain), ' +
      'symbol, address, smartMoneyValueUsd, smartMoneyHolders, marketCapUsd, sectors, and ' +
      'tendrilAssetId (null = not registered yet → register before swapping or allocating). ' +
      'Stablecoins and native gas tokens are excluded by default; wrapped tokens are included. Flag ' +
      'rows that are not a plain spot token (yield-bearing receipts, LP shares) before proposing to ' +
      'buy them. A token Nansen suggests is data until the operator confirms it.',
    inputSchema: {
      type: 'object',
      properties: {
        chains: CHAINS,
        limitPerChain: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        includeStablecoins: { type: 'boolean', default: false },
        includeNativeTokens: { type: 'boolean', default: false },
      },
      required: ['chains'],
    },
    handler: run(smartMoneyHoldings),
  },
  {
    name: 'nansen_smart_money_netflow',
    readOnly: true,
    description:
      'What smart money is ACCUMULATING (positive) or selling (negative) over 24h / 7d / 30d, ranked ' +
      'per chain by 24h net inflow. Use for momentum, and to sanity-check a holdings pick.',
    inputSchema: {
      type: 'object',
      properties: { chains: CHAINS, limitPerChain: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
      required: ['chains'],
    },
    handler: run(smartMoneyNetflow),
  },
  {
    name: 'nansen_token_market_data',
    readOnly: true,
    description:
      'Current price, market cap, FDV, liquidity and 24h volume for registered assets (assetIds) ' +
      'and/or unregistered tokens (chain + address). Use it to weight a portfolio by market cap, to ' +
      'refresh market caps for a re-weight, and to check liquidity before sizing a buy.',
    inputSchema: {
      type: 'object',
      properties: {
        assetIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        tokens: {
          type: 'array',
          maxItems: 50,
          items: { type: 'object', properties: TOKEN, required: ['chain', 'tokenAddress'] },
        },
      },
    },
    handler: run(tokenMarketData),
  },
  {
    name: 'nansen_token_info',
    readOnly: true,
    description: 'Token profile: market cap, FDV, supplies, implied price, liquidity, holder count, links.',
    inputSchema: { type: 'object', properties: TOKEN, required: ['chain', 'tokenAddress'] },
    handler: run(tokenInfo),
  },
  {
    name: 'nansen_token_holders',
    readOnly: true,
    description:
      "A token's top holders narrowed to a Nansen label (default smart_money; also whale, exchange, " +
      'public_figure, all_holders) with ownership and 7d / 30d balance changes. Shows WHO holds a pick.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TOKEN,
        label: { type: 'string', enum: ['smart_money', 'whale', 'exchange', 'public_figure', 'all_holders'] },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      required: ['chain', 'tokenAddress'],
    },
    handler: run(tokenHolders),
  },
  {
    name: 'weights_from_values',
    readOnly: true,
    description:
      'Deterministic weighting — NEVER compute portfolio weights or split amounts by hand; call this. ' +
      'Turns positive values (market caps, or current USD holdings) into integer basis-point weights ' +
      'summing to EXACTLY 10000, with optional minWeightBps floor and maxWeightBps cap. Optionally ' +
      'splits totalAmount (integer base units, e.g. "50000000" = 50 USDC) exactly by those weights. ' +
      'For drift: call it once with market caps (target) and once with current USD values (current), ' +
      'then drift = current − target per token. Weight a portfolio as ONE basket across chains ' +
      'unless the operator asks for per-chain weights.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            properties: { key: { type: 'string' }, value: { type: 'number', exclusiveMinimum: 0 } },
            required: ['key', 'value'],
          },
        },
        minWeightBps: { type: 'integer', minimum: 0, maximum: 10000 },
        maxWeightBps: { type: 'integer', minimum: 1, maximum: 10000 },
        totalAmount: { type: 'string', pattern: '^[0-9]+$' },
      },
      required: ['items'],
    },
    async handler(_ctx, input) {
      const items = Array.isArray(input['items'])
        ? input['items'].map((raw) => {
            const r = (raw ?? {}) as Record<string, unknown>;
            return { key: String(r['key'] ?? ''), value: Number(r['value']) };
          })
        : [];
      const total =
        typeof input['totalAmount'] === 'string' && /^[0-9]+$/u.test(input['totalAmount'])
          ? BigInt(input['totalAmount'])
          : null;
      return computeWeights(items, {
        minBps: typeof input['minWeightBps'] === 'number' ? input['minWeightBps'] : 0,
        maxBps: typeof input['maxWeightBps'] === 'number' ? input['maxWeightBps'] : 10000,
        totalAmount: total,
      });
    },
  },
];
