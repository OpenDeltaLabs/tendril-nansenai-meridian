import { describe, expect, it } from 'vitest';
import { computeWeights } from '../src/weights.ts';

const none = { minBps: 0, maxBps: 10000, totalAmount: null };
const sum = (ws: Array<{ weight_bps: number }>) => ws.reduce((a, w) => a + w.weight_bps, 0);

describe('computeWeights', () => {
  it('weights proportionally and sums to exactly 10000', () => {
    const r = computeWeights(
      [
        { key: 'a', value: 1 },
        { key: 'b', value: 1 },
        { key: 'c', value: 1 },
      ],
      none,
    );
    expect(sum(r.items)).toBe(10000);
    expect(r.items.map((i) => i.weight_bps).sort()).toEqual([3333, 3333, 3334]);
  });

  it('reproduces the demo basket: six smart-money picks, capped at 50%', () => {
    // Market caps from the demo's Nansen snapshot.
    const r = computeWeights(
      [
        { key: 'TIBBIR', value: 244.72e6 },
        { key: 'ABASWETH', value: 6.25e9 },
        { key: 'AERO', value: 716.87e6 },
        { key: 'STONK', value: 307.23e6 },
        { key: 'ZCAT', value: 69.13e6 },
        { key: 'PUMP', value: 1.83e9 },
      ],
      { minBps: 0, maxBps: 5000, totalAmount: 50_000_000n }, // 50 USDC
    );
    const by = Object.fromEntries(r.items.map((i) => [i.key, i]));
    expect(sum(r.items)).toBe(10000);
    expect(by['ABASWETH']?.weight_bps).toBe(5000);
    expect(by['ABASWETH']?.capped).toBe(true);
    expect(by['PUMP']?.weight_bps).toBe(2888);
    expect(r.items.reduce((a, i) => a + BigInt(i.amount ?? '0'), 0n)).toBe(50_000_000n);
  });

  it('raises items under the floor and cascades', () => {
    const r = computeWeights(
      [
        { key: 'big', value: 1000 },
        { key: 'mid', value: 30 },
        { key: 'small', value: 1 },
      ],
      { minBps: 2000, maxBps: 10000, totalAmount: null },
    );
    expect(Object.fromEntries(r.items.map((i) => [i.key, i.weight_bps]))).toEqual({
      big: 6000,
      mid: 2000,
      small: 2000,
    });
  });

  it('rejects impossible bounds', () => {
    const three = [
      { key: 'a', value: 1 },
      { key: 'b', value: 2 },
      { key: 'c', value: 3 },
    ];
    expect(() => computeWeights(three, { ...none, minBps: 4000 })).toThrow(/exceeds 10000/);
    expect(() => computeWeights(three, { ...none, maxBps: 3000 })).toThrow(/below 10000/);
  });
});
