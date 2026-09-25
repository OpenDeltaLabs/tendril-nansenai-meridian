# Demo walkthrough — a Nansen smart-money portfolio, built by the Tendril agent

Recorded live on mainnet with real funds (50 USDC). Every step below is a chat message to the Tendril agent;
everything that moved value was **proposed by the agent and approved and signed by the operator**.

Videos: [1-minute cut](../videos/tendril-nansen-demo-1min.mp4) · [full walkthrough](../videos/tendril-nansen-walkthrough.mp4)

**Starting point:** a Tendril fund ("Smart Money Portfolio") with existing hot wallets on Solana and Base.
All USDC sits on Solana.

---

## 1 · Research with Nansen

> Hey Tendril, I want to build a high-risk, high-reward portfolio using Nansen intelligence. First, find the top 3
> smart-money holdings right now on Base and on Solana, no stablecoins. Then compare their market caps and suggest
> a target allocation, with no single token above 50% of the portfolio. Don't set anything up yet.

Under the hood: `nansen_smart_money_holdings` (one Nansen call per chain) → `weights_from_values` with the market
caps and a 50% cap. About 20 seconds.

| Chain | Rank | Token | Smart-money value | Market cap |
| --- | ---: | --- | ---: | ---: |
| Base | 1 | TIBBIR | $3.52M | $244.7M |
| Base | 2 | ABASWETH* | $2.95M | $6.25B |
| Base | 3 | AERO | $1.36M | $716.9M |
| Solana | 1 | STONK | $47.64M | $307.2M |
| Solana | 2 | ZCAT | $11.65M | $69.1M |
| Solana | 3 | PUMP | $8.54M | $1.83B |

\*The agent flags ABASWETH as a yield-bearing receipt (Aave interest-bearing WETH), not a plain spot token.

Suggested target, market-cap weighted and capped at 50%: **ABASWETH 50.00% · PUMP 28.89% · AERO 11.31% ·
STONK 4.85% · TIBBIR 3.86% · ZCAT 1.09%.** The weights come from the deterministic helper, not from the model's
arithmetic.

## 2 · Custody

> Great, let's go with exactly these six tokens and weights. Before buying anything, set up the custody: create a
> Safe on Base and a Squads multisig on Solana, both 1-of-1.

The agent **proposes** two deployments. The operator approves both in Tendril and signs the Safe deployment on
Base and the Squads creation on Solana. Result: a Safe and a Squads vault, both 1-of-1, managed by Tendril.

## 3 · Attach and register

> Both multisigs are live. Add them to the Smart Money Portfolio, and register the six tokens so Tendril can price
> and trade them.

Two fund-membership changes and five token registrations, approved in one pass. Tendril picks price sources per
token on registration; Nansen is one of them for the long-tail picks.

## 4 · Bridge, buy, move

> Now execute it with 50 USDC: bridge the Base share, buy the six tokens at the agreed weights, then move each
> token into its multisig — Base tokens to the Safe, Solana tokens to the Squads vault. Just this once.

The agent composes **one 13-step plan** that the operator approves once:

1. bridge 32.585 USDC Solana → Base (Circle CCTP; burn, attestation, mint)
2. buy ABASWETH, AERO, TIBBIR on Base (1inch) and move each into the Safe
3. buy PUMP, STONK, ZCAT on Solana (Jupiter) and move each into the Squads vault

Each step waits for the previous one to settle on-chain; "send what the swap returned" is resolved from the
settled result rather than the quote. The operator signs each transaction as it comes up.

**Result — held in the multisigs, valued by Tendril:**

| Token | Chain | Value | Share | Target |
| --- | --- | ---: | ---: | ---: |
| ABASWETH | Base | $24.95 | 49.99% | 50.00% |
| PUMP | Solana | $14.51 | 29.06% | 28.89% |
| AERO | Base | $5.62 | 11.27% | 11.31% |
| STONK | Solana | $2.39 | 4.79% | 4.85% |
| TIBBIR | Base | $1.92 | 3.85% | 3.86% |
| ZCAT | Solana | $0.53 | 1.05% | 1.09% |

Within 0.2 percentage points of target on every position.

## 5 · Is a rebalance needed?

> Let's check this portfolio against the latest Nansen data. Re-check the smart-money top 3 on Base and Solana
> with their market caps, recompute the weights for all six tokens as one basket (max 50% per token, as before),
> and show the drift against what's in the two multisigs now. Would a rebalance be needed, and what would trigger
> one? Don't trade anything.

The agent re-screens Nansen, recomputes the target from fresh market caps, derives the current weights from
Tendril's valuations (again via the deterministic helper) and reports drift per token:

| Token | Current | New target | Drift |
| --- | ---: | ---: | ---: |
| ABASWETH | 50.03% | 50.00% | +3 bps |
| PUMP | 29.02% | 29.02% | 0 bps |
| AERO | 11.29% | 11.17% | +12 bps |
| STONK | 4.76% | 4.80% | −4 bps |
| TIBBIR | 3.85% | 3.92% | −7 bps |
| ZCAT | 1.05% | 1.09% | −4 bps |

**No rebalance needed** — the smart-money top 3 hasn't changed and the largest drift is 12 bps. A rebalance would
be proposed when a token drops out of its chain's top 3 or drift crosses a threshold (e.g. 5 points); the
operator approves it, and Tendril executes it the same way as step 4.

---

## What the operator never had to do

- look up contract addresses, token decimals or routes
- calculate weights, splits or drift
- move funds between chains by hand
- give an agent the power to move money on its own
