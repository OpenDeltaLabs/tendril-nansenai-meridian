import type { AssetRef, PriceSourceDefinition } from '@tendril/connector-sdk';
import { clientFor } from './routes.ts';
import type { NansenConfig } from './schemas.ts';

/**
 * Nansen as a Tendril price source.
 *
 * Nansen covers long-tail tokens (smart-money holdings, memecoins) that
 * exchange feeds and index providers often don't. If the agent picks a token
 * from Nansen data, Tendril must also be able to value it — for NAV, for
 * allocation drift, for reporting. Tendril's pricing policy decides where this
 * source sits in the fallback chain, how stale a price may be, and persists
 * every observation.
 *
 * Current price: the token screener filtered to one token returns `price_usd`
 * plus market cap, FDV and liquidity in a single call; the extra market data is
 * kept on the observation. Historical: token OHLCV (close price + close
 * market cap per bucket).
 */

/** Native gas assets have no contract — price them via the wrapped token Nansen indexes. */
const NATIVE_TO_WRAPPED: Record<string, string> = {
  asset_sol_solana: 'So11111111111111111111111111111111111111112',
  asset_eth_base: '0x4200000000000000000000000000000000000006',
  asset_eth_ethereum: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
};

/** Quotes treated as 1:1 USD — Nansen reports USD prices. */
const USD_QUOTES = new Set(['asset_usd', 'asset_usdc_solana', 'asset_usdc_base', 'asset_usdc_ethereum']);

const contractFor = (asset: AssetRef): string | null => asset.contractAddress ?? NATIVE_TO_WRAPPED[asset.id] ?? null;

export const nansenPriceSource: PriceSourceDefinition<NansenConfig> = {
  id: 'nansen',
  kind: 'network_specific',

  supports(asset, quote) {
    return contractFor(asset) !== null && asset.networkId !== null && USD_QUOTES.has(quote.id);
  },

  async fetchPrice(ctx, asset, quote) {
    const address = contractFor(asset);
    if (!address || !asset.networkId || !ctx.config.chains.includes(asset.networkId)) return null;
    const { data } = await clientFor(ctx).tokenMarketData(asset.networkId, [address]);
    const row = data.find((r) => r.token_address.toLowerCase() === address.toLowerCase());
    if (!row?.price_usd || row.price_usd <= 0) return null;
    return {
      assetId: asset.id,
      quoteAssetId: quote.id,
      price: decimalString(row.price_usd),
      observedAt: ctx.now(),
      metadata: {
        marketCapUsd: row.market_cap_usd ?? null,
        fdvUsd: row.fdv ?? null,
        liquidityUsd: row.liquidity ?? null,
        volume24hUsd: row.volume ?? null,
      },
    };
  },

  async fetchHistorical(ctx, asset, quote, { from, to, interval }) {
    const address = contractFor(asset);
    if (!address || !asset.networkId) return [];
    const { data } = await clientFor(ctx).tokenOhlcv(asset.networkId, address, interval);
    return data
      .filter((r) => {
        const at = new Date(r.interval_start);
        return at >= from && at <= to && typeof r.close === 'number' && r.close > 0;
      })
      .map((r) => ({
        assetId: asset.id,
        quoteAssetId: quote.id,
        price: decimalString(r.close as number),
        observedAt: new Date(r.interval_start),
        metadata: { interval, marketCapUsd: r.market_cap?.close ?? null },
      }));
  },

  async canPrice(ctx, identity) {
    if (!identity.contractAddress || !identity.networkId) return false;
    try {
      const { data } = await clientFor(ctx).tokenMarketData(identity.networkId, [identity.contractAddress]);
      return data.some((r) => typeof r.price_usd === 'number' && r.price_usd > 0);
    } catch {
      return false; // a flaky probe must never block asset registration
    }
  },
};

function decimalString(n: number): string {
  return n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 18 });
}
