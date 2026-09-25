import { z } from 'zod';
import { ConnectorError } from '@tendril/connector-sdk';
import {
  listOf,
  OhlcvRow,
  SmartMoneyHoldingRow,
  SmartMoneyNetflowRow,
  TokenHolderRow,
  TokenInformation,
  TokenScreenerRow,
  type HolderLabel,
} from './schemas.ts';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PER_PAGE = 100;

export interface SmartMoneyQuery {
  chains: string[];
  limit?: number;
  /** Nansen excludes stablecoins by default. */
  includeStablecoins?: boolean;
  /** Native gas tokens (SOL / ETH); wrapped variants are always included. */
  includeNativeTokens?: boolean;
}

/**
 * Thin client over the Nansen REST API (`POST` + JSON, `apikey` header).
 * One method per endpoint the connector uses; every response is schema-parsed
 * so an upstream shape change fails loudly at the boundary.
 */
export class NansenClient {
  constructor(
    private readonly opts: {
      baseUrl: string;
      apiKey: string | undefined;
      fetch: typeof fetch;
    },
  ) {}

  /** Tokens smart-money wallets hold the most USD value in, ordered by value held. */
  async smartMoneyHoldings(q: SmartMoneyQuery) {
    return listOf(SmartMoneyHoldingRow).parse(
      await this.post('/api/v1/smart-money/holdings', {
        chains: q.chains,
        filters: filters(q),
        pagination: { page: 1, per_page: clamp(q.limit) },
        order_by: [{ field: 'value_usd', direction: 'DESC' }],
      }),
    );
  }

  /** Smart-money net flows (1h / 24h / 7d / 30d), ordered by 24h net inflow. */
  async smartMoneyNetflow(q: SmartMoneyQuery) {
    return listOf(SmartMoneyNetflowRow).parse(
      await this.post('/api/v1/smart-money/netflow', {
        chains: q.chains,
        filters: filters(q),
        pagination: { page: 1, per_page: clamp(q.limit) },
        order_by: [{ field: 'net_flow_24h_usd', direction: 'DESC' }],
      }),
    );
  }

  /** Price, market cap, FDV and liquidity for specific tokens on one chain — one call. */
  async tokenMarketData(chain: string, tokenAddresses: string[]) {
    if (tokenAddresses.length === 0) return { data: [] };
    return listOf(TokenScreenerRow).parse(
      await this.post('/api/v1/token-screener', {
        chains: [chain],
        timeframe: '24h',
        filters: { token_address: tokenAddresses },
        pagination: { page: 1, per_page: Math.min(tokenAddresses.length, MAX_PER_PAGE) },
      }),
    );
  }

  async tokenInformation(chain: string, tokenAddress: string) {
    const body = await this.post('/api/v1/tgm/token-information', {
      chain,
      token_address: tokenAddress,
      timeframe: '1d',
    });
    return z.object({ data: TokenInformation }).parse(body).data;
  }

  async tokenHolders(chain: string, tokenAddress: string, label: HolderLabel, limit?: number) {
    return listOf(TokenHolderRow).parse(
      await this.post('/api/v1/tgm/holders', {
        chain,
        token_address: tokenAddress,
        label_type: label,
        pagination: { page: 1, per_page: clamp(limit) },
      }),
    );
  }

  async tokenOhlcv(chain: string, tokenAddress: string, timeframe: '1h' | '1d') {
    return z
      .object({ data: z.array(OhlcvRow) })
      .parse(await this.post('/api/v1/tgm/token-ohlcv', { chain, token_address: tokenAddress, timeframe }));
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    if (!this.opts.apiKey) {
      throw new ConnectorError('not_configured', 'Nansen API key is not configured (secret NANSEN_API_KEY)');
    }
    let res: Response;
    try {
      res = await this.opts.fetch(`${this.opts.baseUrl.replace(/\/$/u, '')}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          apikey: this.opts.apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Timeouts / network failures are transient — callers may retry.
      throw new ConnectorError('upstream_error', `Nansen ${path} unreachable: ${String(err)}`);
    }
    if (res.status === 429) throw new ConnectorError('rate_limited', `Nansen ${path}: rate limited`);
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new ConnectorError(
        res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403
          ? 'invalid_input'
          : 'upstream_error',
        `Nansen ${path} ${res.status}: ${text}`,
      );
    }
    return res.json();
  }
}

function clamp(limit: number | undefined): number {
  if (limit === undefined) return 10;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PER_PAGE);
}

function filters(q: SmartMoneyQuery): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if (q.includeStablecoins !== undefined) f['include_stablecoins'] = q.includeStablecoins;
  if (q.includeNativeTokens !== undefined) f['include_native_tokens'] = q.includeNativeTokens;
  return f;
}

/** Nansen's `*_percent` / `*_change` fields are fractions; the connector returns real percentages. */
export function pct(fraction: number | null | undefined): number | null {
  if (fraction === null || fraction === undefined) return null;
  return Math.round(fraction * 100 * 10_000) / 10_000;
}
