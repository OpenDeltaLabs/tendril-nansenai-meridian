import { describe, expect, it, vi } from 'vitest';
import { ConnectorError } from '@tendril/connector-sdk';
import { NansenClient, pct } from '../src/client.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('NansenClient', () => {
  it('queries smart-money holdings ordered by value held', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        data: [
          {
            chain: 'base',
            token_address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631',
            token_symbol: 'AERO',
            value_usd: 1_280_555,
            market_cap_usd: 701_908_205,
          },
        ],
      }),
    );
    const client = new NansenClient({ baseUrl: 'https://api.nansen.ai', apiKey: 'k', fetch: fetchMock });
    const res = await client.smartMoneyHoldings({ chains: ['base'], limit: 3 });

    expect(res.data[0]?.token_symbol).toBe('AERO');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.nansen.ai/api/v1/smart-money/holdings');
    expect((init.headers as Record<string, string>)['apikey']).toBe('k');
    expect(JSON.parse(init.body as string)).toMatchObject({
      chains: ['base'],
      pagination: { page: 1, per_page: 3 },
      order_by: [{ field: 'value_usd', direction: 'DESC' }],
    });
  });

  it('maps upstream failures onto connector errors', async () => {
    const client = (status: number) =>
      new NansenClient({ baseUrl: 'https://x', apiKey: 'k', fetch: vi.fn().mockResolvedValue(new Response('no', { status })) });
    await expect(client(429).smartMoneyNetflow({ chains: ['solana'] })).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(client(422).tokenInformation('nope', '0x1')).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(client(500).tokenInformation('base', '0x1')).rejects.toMatchObject({ code: 'upstream_error' });
  });

  it('refuses to call without an API key', async () => {
    const fetchMock = vi.fn();
    const client = new NansenClient({ baseUrl: 'https://x', apiKey: undefined, fetch: fetchMock });
    await expect(client.smartMoneyHoldings({ chains: ['base'] })).rejects.toBeInstanceOf(ConnectorError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('converts Nansen fractions to real percentages', () => {
    expect(pct(0.1009)).toBe(10.09);
    expect(pct(-0.028)).toBe(-2.8);
    expect(pct(null)).toBeNull();
  });
});
