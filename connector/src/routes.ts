import { z } from 'zod';
import { ConnectorError, type ConnectorContext, type DataRoute } from '@tendril/connector-sdk';
import { NansenClient, pct } from './client.ts';
import { HOLDER_LABELS, type NansenConfig } from './schemas.ts';

/**
 * Read-only data routes. Tendril mounts each under
 * `GET /v1/connectors/nansen/{path}`, generates the OpenAPI entry from the
 * input / output schemas, and handles auth, org scoping and rate limits.
 *
 * Every token row is annotated with `tendrilAssetId` — the asset Tendril has
 * registered for that (chain, contract), or null — so a caller (or the agent)
 * immediately knows what it can value, swap or put in a target allocation.
 */

type Ctx = ConnectorContext<NansenConfig>;

export function clientFor(ctx: Ctx): NansenClient {
  return new NansenClient({
    baseUrl: ctx.config.baseUrl,
    apiKey: ctx.secrets.get('NANSEN_API_KEY'),
    fetch: ctx.fetch,
  });
}

/** Wrapped-native tokens Nansen reports for a chain's gas token → the native asset. */
const WRAPPED_NATIVE: Record<string, string> = {
  'solana:so11111111111111111111111111111111111111112': 'asset_sol_solana',
  'base:0x4200000000000000000000000000000000000006': 'asset_eth_base',
};

async function tendrilAssetId(ctx: Ctx, chain: string, address: string): Promise<string | null> {
  const found = await ctx.assets.findByContract(chain, address);
  return found?.id ?? WRAPPED_NATIVE[`${chain}:${address.toLowerCase()}`] ?? null;
}

function assertChains(ctx: Ctx, chains: string[]): void {
  const outOfScope = chains.filter((c) => !ctx.config.chains.includes(c));
  if (outOfScope.length > 0) {
    throw new ConnectorError('invalid_input', `chains not served by this instance: ${outOfScope.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------

const SmartMoneyInput = z.object({
  chains: z.array(z.string().min(1)).min(1).max(5),
  limitPerChain: z.number().int().min(1).max(100).default(10),
  includeStablecoins: z.boolean().optional(),
  includeNativeTokens: z.boolean().optional(),
});

const TokenRef = {
  chain: z.string(),
  tokenAddress: z.string(),
  symbol: z.string().nullable(),
  tendrilAssetId: z.string().nullable(),
};

const HoldingsOutput = z.object({
  asOf: z.string(),
  source: z.literal('nansen'),
  data: z.array(
    z.object({
      ...TokenRef,
      rank: z.number().int(),
      sectors: z.array(z.string()),
      smartMoneyValueUsd: z.number().nullable(),
      smartMoneyHolders: z.number().nullable(),
      smartMoneyBalanceChange24hPct: z.number().nullable(),
      shareOfSmartMoneyHoldingsPct: z.number().nullable(),
      marketCapUsd: z.number().nullable(),
    }),
  ),
});

export const smartMoneyHoldings: DataRoute<NansenConfig, z.infer<typeof SmartMoneyInput>, z.infer<typeof HoldingsOutput>> = {
  id: 'smart_money_holdings',
  path: 'smart-money/holdings',
  summary: 'Top tokens held by smart money, per chain',
  description:
    "The tokens Nansen's labelled smart-money wallets hold the most USD value in — queried per " +
    'chain so the limit is a true top N on each. Stablecoins and native gas tokens excluded by default.',
  input: SmartMoneyInput,
  output: HoldingsOutput,
  async handler(ctx, input) {
    assertChains(ctx, input.chains);
    const nansen = clientFor(ctx);
    const perChain = await Promise.all(
      input.chains.map((chain) =>
        nansen.smartMoneyHoldings({
          chains: [chain],
          limit: input.limitPerChain,
          ...(input.includeStablecoins !== undefined ? { includeStablecoins: input.includeStablecoins } : {}),
          ...(input.includeNativeTokens !== undefined ? { includeNativeTokens: input.includeNativeTokens } : {}),
        }),
      ),
    );
    const rows = perChain.flatMap((r) => r.data.map((row, i) => ({ row, rank: i + 1 })));
    return {
      asOf: ctx.now().toISOString(),
      source: 'nansen' as const,
      data: await Promise.all(
        rows.map(async ({ row, rank }) => ({
          chain: row.chain,
          tokenAddress: row.token_address,
          symbol: row.token_symbol ?? null,
          tendrilAssetId: await tendrilAssetId(ctx, row.chain, row.token_address),
          rank,
          sectors: row.token_sectors ?? [],
          smartMoneyValueUsd: row.value_usd ?? null,
          smartMoneyHolders: row.holders_count ?? null,
          smartMoneyBalanceChange24hPct: pct(row.balance_24h_percent_change),
          shareOfSmartMoneyHoldingsPct: pct(row.share_of_holdings_percent),
          marketCapUsd: row.market_cap_usd ?? null,
        })),
      ),
    };
  },
};

// ---------------------------------------------------------------------------

const NetflowOutput = z.object({
  asOf: z.string(),
  source: z.literal('nansen'),
  data: z.array(
    z.object({
      ...TokenRef,
      rank: z.number().int(),
      netFlow24hUsd: z.number().nullable(),
      netFlow7dUsd: z.number().nullable(),
      netFlow30dUsd: z.number().nullable(),
      traderCount: z.number().nullable(),
      marketCapUsd: z.number().nullable(),
    }),
  ),
});

export const smartMoneyNetflow: DataRoute<NansenConfig, z.infer<typeof SmartMoneyInput>, z.infer<typeof NetflowOutput>> = {
  id: 'smart_money_netflow',
  path: 'smart-money/netflow',
  summary: 'What smart money is accumulating or selling, per chain',
  description: 'Smart-money net flows over 1h / 24h / 7d / 30d, ranked per chain by 24h net inflow.',
  input: SmartMoneyInput,
  output: NetflowOutput,
  async handler(ctx, input) {
    assertChains(ctx, input.chains);
    const nansen = clientFor(ctx);
    const perChain = await Promise.all(
      input.chains.map((chain) => nansen.smartMoneyNetflow({ chains: [chain], limit: input.limitPerChain })),
    );
    const rows = perChain.flatMap((r) => r.data.map((row, i) => ({ row, rank: i + 1 })));
    return {
      asOf: ctx.now().toISOString(),
      source: 'nansen' as const,
      data: await Promise.all(
        rows.map(async ({ row, rank }) => ({
          chain: row.chain,
          tokenAddress: row.token_address,
          symbol: row.token_symbol ?? null,
          tendrilAssetId: await tendrilAssetId(ctx, row.chain, row.token_address),
          rank,
          netFlow24hUsd: row.net_flow_24h_usd ?? null,
          netFlow7dUsd: row.net_flow_7d_usd ?? null,
          netFlow30dUsd: row.net_flow_30d_usd ?? null,
          traderCount: row.trader_count ?? null,
          marketCapUsd: row.market_cap_usd ?? null,
        })),
      ),
    };
  },
};

// ---------------------------------------------------------------------------

const MarketDataInput = z.object({
  /** Registered Tendril assets, and/or raw tokens not registered yet. */
  assetIds: z.array(z.string()).max(50).default([]),
  tokens: z.array(z.object({ chain: z.string(), tokenAddress: z.string() })).max(50).default([]),
});

const MarketDataOutput = z.object({
  asOf: z.string(),
  source: z.literal('nansen'),
  data: z.array(
    z.object({
      ...TokenRef,
      priceUsd: z.number().nullable(),
      marketCapUsd: z.number().nullable(),
      fdvUsd: z.number().nullable(),
      liquidityUsd: z.number().nullable(),
      volume24hUsd: z.number().nullable(),
      priceChange24hPct: z.number().nullable(),
    }),
  ),
  /** Requested tokens Nansen returned nothing for. */
  missing: z.array(z.string()),
});

export const tokenMarketData: DataRoute<NansenConfig, z.infer<typeof MarketDataInput>, z.infer<typeof MarketDataOutput>> = {
  id: 'token_market_data',
  path: 'tokens/market-data',
  summary: 'Price, market cap and liquidity for tokens',
  description:
    'Batched per chain (one Nansen call per chain). Use it to weight a portfolio by market cap ' +
    'or to refresh the market caps of what a fund holds.',
  input: MarketDataInput,
  output: MarketDataOutput,
  async handler(ctx, input) {
    const refs: Array<{ chain: string; tokenAddress: string; label: string }> = input.tokens.map((t) => ({
      ...t,
      label: `${t.chain}:${t.tokenAddress}`,
    }));
    for (const id of input.assetIds) {
      const a = await ctx.assets.get(id);
      if (!a?.networkId || !a.contractAddress) {
        throw new ConnectorError('invalid_input', `asset ${id} is unknown or has no onchain contract`);
      }
      refs.push({ chain: a.networkId, tokenAddress: a.contractAddress, label: id });
    }
    if (refs.length === 0) throw new ConnectorError('invalid_input', 'pass assetIds and/or tokens');

    const nansen = clientFor(ctx);
    const byChain = new Map<string, string[]>();
    for (const r of refs) byChain.set(r.chain, [...(byChain.get(r.chain) ?? []), r.tokenAddress]);
    const results = await Promise.all([...byChain].map(([chain, addrs]) => nansen.tokenMarketData(chain, addrs)));
    const found = new Map(
      results.flatMap((r) => r.data).map((row) => [`${row.chain}:${row.token_address.toLowerCase()}`, row]),
    );

    const data = [];
    const missing: string[] = [];
    for (const ref of refs) {
      const row = found.get(`${ref.chain}:${ref.tokenAddress.toLowerCase()}`);
      if (!row) {
        missing.push(ref.label);
        continue;
      }
      data.push({
        chain: ref.chain,
        tokenAddress: row.token_address,
        symbol: row.token_symbol ?? null,
        tendrilAssetId: await tendrilAssetId(ctx, ref.chain, ref.tokenAddress),
        priceUsd: row.price_usd ?? null,
        marketCapUsd: row.market_cap_usd ?? null,
        fdvUsd: row.fdv ?? null,
        liquidityUsd: row.liquidity ?? null,
        volume24hUsd: row.volume ?? null,
        priceChange24hPct: pct(row.price_change),
      });
    }
    return { asOf: ctx.now().toISOString(), source: 'nansen' as const, data, missing };
  },
};

// ---------------------------------------------------------------------------

const TokenInput = z.object({ chain: z.string(), tokenAddress: z.string() });

const TokenInfoOutput = z.object({
  ...TokenRef,
  name: z.string().nullable(),
  logoUrl: z.string().nullable(),
  marketCapUsd: z.number().nullable(),
  fdvUsd: z.number().nullable(),
  circulatingSupply: z.number().nullable(),
  totalSupply: z.number().nullable(),
  /** marketCap / circulatingSupply when both are known. */
  impliedPriceUsd: z.number().nullable(),
  liquidityUsd: z.number().nullable(),
  totalHolders: z.number().nullable(),
});

export const tokenInfo: DataRoute<NansenConfig, z.infer<typeof TokenInput>, z.infer<typeof TokenInfoOutput>> = {
  id: 'token_info',
  path: 'tokens/info',
  summary: 'Token profile',
  description: 'Market cap, FDV, supplies, liquidity, holder count and links for one token.',
  input: TokenInput,
  output: TokenInfoOutput,
  async handler(ctx, { chain, tokenAddress }) {
    const info = await clientFor(ctx).tokenInformation(chain, tokenAddress);
    const d = info.token_details ?? {};
    const mcap = d.market_cap_usd ?? null;
    const circ = d.circulating_supply ?? null;
    return {
      chain,
      tokenAddress,
      symbol: info.symbol ?? null,
      tendrilAssetId: await tendrilAssetId(ctx, chain, tokenAddress),
      name: info.name ?? null,
      logoUrl: info.logo ?? null,
      marketCapUsd: mcap,
      fdvUsd: d.fdv_usd ?? null,
      circulatingSupply: circ,
      totalSupply: d.total_supply ?? null,
      impliedPriceUsd: mcap !== null && circ ? mcap / circ : null,
      liquidityUsd: info.spot_metrics?.liquidity_usd ?? null,
      totalHolders: info.spot_metrics?.total_holders ?? null,
    };
  },
};

// ---------------------------------------------------------------------------

const HoldersInput = TokenInput.extend({
  label: z.enum(HOLDER_LABELS).default('smart_money'),
  limit: z.number().int().min(1).max(100).default(10),
});

const HoldersOutput = z.object({
  asOf: z.string(),
  chain: z.string(),
  tokenAddress: z.string(),
  label: z.string(),
  data: z.array(
    z.object({
      address: z.string(),
      label: z.string().nullable(),
      valueUsd: z.number().nullable(),
      ownershipPct: z.number().nullable(),
      balanceChange7d: z.number().nullable(),
      balanceChange30d: z.number().nullable(),
    }),
  ),
});

export const tokenHolders: DataRoute<NansenConfig, z.infer<typeof HoldersInput>, z.infer<typeof HoldersOutput>> = {
  id: 'token_holders',
  path: 'tokens/holders',
  summary: "A token's top holders by label",
  description: 'Top holders narrowed to a Nansen label class (smart money, whales, exchanges, …).',
  input: HoldersInput,
  output: HoldersOutput,
  async handler(ctx, input) {
    const res = await clientFor(ctx).tokenHolders(input.chain, input.tokenAddress, input.label, input.limit);
    return {
      asOf: ctx.now().toISOString(),
      chain: input.chain,
      tokenAddress: input.tokenAddress,
      label: input.label,
      data: res.data.map((h) => ({
        address: h.address,
        label: h.address_label ?? null,
        valueUsd: h.value_usd ?? null,
        ownershipPct: pct(h.ownership_percentage),
        balanceChange7d: h.balance_change_7d ?? null,
        balanceChange30d: h.balance_change_30d ?? null,
      })),
    };
  },
};

export const routes = [smartMoneyHoldings, smartMoneyNetflow, tokenMarketData, tokenInfo, tokenHolders];
