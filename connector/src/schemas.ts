import { z } from 'zod';

/** Connector instance config. The API key is a secret, never config. */
export const NansenConfigSchema = z.object({
  baseUrl: z.string().url().default('https://api.nansen.ai'),
  /** Chains this instance answers for (Nansen chain slugs = Tendril network ids). */
  chains: z
    .array(z.string().min(1))
    .default(['solana', 'base', 'ethereum', 'arbitrum', 'optimism', 'polygon']),
});
export type NansenConfig = z.infer<typeof NansenConfigSchema>;

const num = z.number().nullish();
const Pagination = z
  .object({ page: z.number(), per_page: z.number(), is_last_page: z.boolean() })
  .partial();

export const listOf = <T extends z.ZodTypeAny>(row: T) =>
  z.object({ data: z.array(row), pagination: Pagination.nullish() });

/** `POST /api/v1/smart-money/holdings` */
export const SmartMoneyHoldingRow = z.object({
  chain: z.string(),
  token_address: z.string(),
  token_symbol: z.string().nullish(),
  token_sectors: z.array(z.string()).nullish(),
  value_usd: num,
  balance_24h_percent_change: num, // fraction: 0.1 = 10%
  holders_count: num,
  share_of_holdings_percent: num, // fraction
  token_age_days: num,
  market_cap_usd: num,
});
export type SmartMoneyHoldingRow = z.infer<typeof SmartMoneyHoldingRow>;

/** `POST /api/v1/smart-money/netflow` */
export const SmartMoneyNetflowRow = z.object({
  chain: z.string(),
  token_address: z.string(),
  token_symbol: z.string().nullish(),
  token_sectors: z.array(z.string()).nullish(),
  net_flow_1h_usd: num,
  net_flow_24h_usd: num,
  net_flow_7d_usd: num,
  net_flow_30d_usd: num,
  trader_count: num,
  market_cap_usd: num,
});
export type SmartMoneyNetflowRow = z.infer<typeof SmartMoneyNetflowRow>;

/** `POST /api/v1/token-screener` — used with a `token_address` filter for price + market cap. */
export const TokenScreenerRow = z.object({
  chain: z.string(),
  token_address: z.string(),
  token_symbol: z.string().nullish(),
  price_usd: num,
  price_change: num, // fraction
  market_cap_usd: num,
  fdv: num,
  liquidity: num,
  volume: num,
});
export type TokenScreenerRow = z.infer<typeof TokenScreenerRow>;

/** `POST /api/v1/tgm/token-information` */
export const TokenInformation = z.object({
  name: z.string().nullish(),
  symbol: z.string().nullish(),
  logo: z.string().nullish(),
  token_details: z
    .object({
      token_deployment_date: z.string().nullish(),
      website: z.string().nullish(),
      x: z.string().nullish(),
      market_cap_usd: num,
      fdv_usd: num,
      circulating_supply: num,
      total_supply: num,
    })
    .partial()
    .nullish(),
  spot_metrics: z
    .object({ volume_total_usd: num, liquidity_usd: num, total_holders: num })
    .partial()
    .nullish(),
});
export type TokenInformation = z.infer<typeof TokenInformation>;

/** `POST /api/v1/tgm/holders` */
export const TokenHolderRow = z.object({
  address: z.string(),
  address_label: z.string().nullish(),
  token_amount: num,
  value_usd: num,
  ownership_percentage: num, // fraction
  balance_change_24h: num,
  balance_change_7d: num,
  balance_change_30d: num,
});
export type TokenHolderRow = z.infer<typeof TokenHolderRow>;

/** `POST /api/v1/tgm/token-ohlcv` */
export const OhlcvRow = z.object({
  interval_start: z.string(),
  close: num,
  market_cap: z.object({ close: num }).partial().nullish(),
});

export const HOLDER_LABELS = [
  'smart_money',
  'whale',
  'exchange',
  'public_figure',
  'all_holders',
] as const;
export type HolderLabel = (typeof HOLDER_LABELS)[number];
