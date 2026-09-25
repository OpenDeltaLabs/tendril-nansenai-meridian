/**
 * Deterministic portfolio weighting.
 *
 * Turns positive values (market caps, smart-money USD held, current USD
 * holdings, …) into integer basis-point weights that sum to EXACTLY 10000,
 * proportional to value, with an optional floor and cap. Optionally splits an
 * integer base-unit amount by those weights, remainders going to the largest
 * weights, so the parts sum exactly to the total.
 *
 * The agent is told never to compute weights or splits by hand — it calls
 * this. Used both for target weights (from Nansen market caps) and for current
 * weights (from Tendril-marked USD holdings), so drift = current − target is
 * computed on identical footing.
 */

export interface WeightedItem {
  key: string;
  value: number;
  /** Plain proportional share before floor / cap, in bps (rounded, informational). */
  proportional_bps: number;
  weight_bps: number;
  weight_percent: string;
  floored: boolean;
  capped: boolean;
  /** Integer base-unit share of `total_amount`, when one was given. */
  amount?: string;
}

export interface WeightsResult {
  total_bps: 10000;
  min_weight_bps: number;
  max_weight_bps: number;
  total_amount: string | null;
  items: WeightedItem[];
}

/**
 * Proportional bps weights summing to exactly 10000, with an optional floor
 * and cap. Items pinned at the floor / cap are fixed and the remaining budget
 * is re-spread proportionally over the rest until nothing violates a bound;
 * the final integer split uses largest-remainder rounding so the sum is exact.
 * Rounding never pushes a floored / capped item past its bound because those
 * are pinned to exact integers before the remainder pass.
 */
export function computeWeights(
  rawItems: Array<{ key: string; value: number }>,
  opts: { minBps: number; maxBps: number; totalAmount: bigint | null },
): WeightsResult {
  const items = rawItems.filter((i) => i.key.length > 0);
  if (items.length === 0) throw new Error('weights_from_values needs at least one item');
  for (const i of items) {
    if (!Number.isFinite(i.value) || i.value <= 0) {
      throw new Error(`weights_from_values: value for '${i.key}' must be a positive number`);
    }
  }
  const keys = new Set(items.map((i) => i.key));
  if (keys.size !== items.length) throw new Error('weights_from_values: keys must be unique');

  const minBps = Math.max(0, Math.trunc(opts.minBps));
  const maxBps = Math.min(10000, Math.trunc(opts.maxBps));
  if (minBps > maxBps) throw new Error('min_weight_bps must be ≤ max_weight_bps');
  if (minBps * items.length > 10000) {
    throw new Error(
      `min_weight_bps ${minBps} × ${items.length} items exceeds 10000 — lower the floor or drop items`,
    );
  }
  if (maxBps * items.length < 10000) {
    throw new Error(
      `max_weight_bps ${maxBps} × ${items.length} items is below 10000 — raise the cap or add items`,
    );
  }

  const sum = items.reduce((a, i) => a + i.value, 0);
  const pinned = new Map<string, { bps: number; floored: boolean; capped: boolean }>();
  // Iterate: spread the unpinned budget proportionally, pin every violator, repeat.
  for (let guard = 0; guard <= items.length; guard++) {
    const free = items.filter((i) => !pinned.has(i.key));
    const budget = 10000 - [...pinned.values()].reduce((a, p) => a + p.bps, 0);
    const freeSum = free.reduce((a, i) => a + i.value, 0);
    let changed = false;
    for (const i of free) {
      const share = (budget * i.value) / freeSum;
      if (share < minBps) {
        pinned.set(i.key, { bps: minBps, floored: true, capped: false });
        changed = true;
      } else if (share > maxBps) {
        pinned.set(i.key, { bps: maxBps, floored: false, capped: true });
        changed = true;
      }
    }
    if (!changed) break;
  }

  const free = items.filter((i) => !pinned.has(i.key));
  const budget = 10000 - [...pinned.values()].reduce((a, p) => a + p.bps, 0);
  const freeSum = free.reduce((a, i) => a + i.value, 0);
  const exact = new Map(free.map((i) => [i.key, (budget * i.value) / freeSum]));
  const bps = new Map<string, number>();
  for (const [k, p] of pinned) bps.set(k, p.bps);
  for (const [k, x] of exact) bps.set(k, Math.floor(x));
  let short = 10000 - [...bps.values()].reduce((a, b) => a + b, 0);
  const byRemainder = [...exact].sort(
    (a, b) => b[1] - Math.floor(b[1]) - (a[1] - Math.floor(a[1])),
  );
  for (const [k] of byRemainder) {
    if (short <= 0) break;
    bps.set(k, (bps.get(k) ?? 0) + 1);
    short -= 1;
  }
  // All-pinned edge case (every item floored/capped exactly to 10000) leaves short = 0.

  const amounts = opts.totalAmount !== null ? splitAmount(opts.totalAmount, items, bps) : null;
  return {
    total_bps: 10000,
    min_weight_bps: minBps,
    max_weight_bps: maxBps,
    total_amount: opts.totalAmount !== null ? opts.totalAmount.toString() : null,
    items: items.map((i) => {
      const w = bps.get(i.key) ?? 0;
      const p = pinned.get(i.key);
      return {
        key: i.key,
        value: i.value,
        proportional_bps: Math.round((10000 * i.value) / sum),
        weight_bps: w,
        weight_percent: `${(w / 100).toFixed(2)}%`,
        floored: p?.floored ?? false,
        capped: p?.capped ?? false,
        ...(amounts ? { amount: (amounts.get(i.key) ?? 0n).toString() } : {}),
      };
    }),
  };
}

function splitAmount(
  total: bigint,
  items: Array<{ key: string }>,
  bps: Map<string, number>,
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  let allocated = 0n;
  for (const i of items) {
    const part = (total * BigInt(bps.get(i.key) ?? 0)) / 10000n;
    out.set(i.key, part);
    allocated += part;
  }
  // Remainder (< items.length base units) goes one unit at a time to the heaviest weights.
  const order = [...items].sort((a, b) => (bps.get(b.key) ?? 0) - (bps.get(a.key) ?? 0));
  let rest = total - allocated;
  for (let idx = 0; rest > 0n; idx = (idx + 1) % order.length) {
    const k = order[idx]!.key;
    out.set(k, (out.get(k) ?? 0n) + 1n);
    rest -= 1n;
  }
  return out;
}
