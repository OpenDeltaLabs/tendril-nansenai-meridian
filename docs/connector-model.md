# The Tendril connector model

A **connector** teaches Tendril about one external system — a data provider like Nansen, a DEX or aggregator, a
lending protocol, a bridge, a custodian. Tendril itself stays chain- and venue-agnostic; connectors are how it
reaches the outside world.

This page describes the model the [Connector SDK (preview)](../sdk/README.md) is built around. The SDK is not
published yet — shapes may still change.

## What a connector declares

| Declaration | Example (Nansen) | Why it matters |
| --- | --- | --- |
| **Kind** | `nansen` | Stable id; one kind can have several instances (e.g. different chain scopes or accounts). |
| **Category** | `data_provider` | Grouping and discovery in the workspace. |
| **Capabilities + scope** | `data.smart_money` on `[solana, base, …]` | Tendril resolves connectors **by capability and scope, not by name**. Anything that needs smart-money data on Base finds whichever connector offers it. |
| **Config** | chains in scope, base URL | Validated at creation; drives the capability scope. |
| **Secrets** | `NANSEN_API_KEY` | Never stored in config; injected by Tendril at call time. |

## What a connector implements

| Hook | Used for | Nansen implements |
| --- | --- | --- |
| **Data routes** | Read-only endpoints mounted on the Tendril API (`/v1/connectors/{kind}/…`), with OpenAPI generated from the schemas, plus auth, org scoping and rate limits applied by Tendril. | holdings, netflow, market data, token info, holders |
| **Price source** | Plugs into Tendril's pricing policy next to built-in sources; Tendril decides fallback order, staleness and persistence. | spot price + market cap, OHLCV history |
| **Agent tools** | Read-only tools the Tendril agent can call, with descriptions written for the model. | five Nansen tools + deterministic weighting |
| **Execution** *(beyond this preview)* | Building transactions for a venue (swap, bridge, deposit). | — (read-only connector) |

## Who does what

```
┌───────────────────────────────┐        ┌──────────────────────────────────────────┐
│ Connector                     │        │ Tendril                                  │
│  • talks to one external API  │ hooks  │  • real-time double-entry ledger         │
│  • validates its responses    │◀──────▶│  • pricing policy, NAV, allocation drift │
│  • maps data into Tendril     │        │  • permissions & org scoping             │
│    shapes (asset refs, bps,   │        │  • intents: propose → approve → sign     │
│    decimal strings)           │        │  • REST API + OpenAPI, the agent         │
└───────────────────────────────┘        └──────────────────────────────────────────┘
```

A connector stays small because Tendril owns everything around it. The Nansen connector has no database, no
auth, no retry scheduler and no UI — it maps Nansen onto Tendril's shapes and nothing more.

## Rules every connector follows

1. **Connectors never move funds on their own.** Execution connectors *build* transactions; Tendril turns them
   into intents that the operator (or an agreed policy) approves and signs. Agents propose; humans decide.
2. **Connectors don't post to the ledger.** They report what happened; Tendril reconciles against onchain
   state before anything is final.
3. **Money is integers.** Amounts travel as base-unit strings; decimals are for display. Prices are decimal
   strings.
4. **Secrets are secrets.** Declared, injected at runtime, never logged or stored in config.
5. **Fail loudly at the boundary.** Validate every upstream response; map failures onto clear errors
   (`upstream_error`, `rate_limited`, `invalid_input`, `not_configured`).
6. **Be read-only unless you must not be.** A data connector is the easiest to review and to trust.

## How a connector reaches Tendril (planned)

Two ways are planned:

- **Hosted** — publish the connector package to your Tendril workspace; Tendril runs it in a sandbox with
  egress limited to the hosts it declares.
- **Remote** — run the connector yourself behind HTTPS; Tendril calls its hooks with signed requests. Useful
  for proprietary data or strategies you don't want to ship.

Either way, callers only ever talk to the Tendril API — the connector's routes and tools appear there like
built-in ones.

Interested in building one? **[Join the closed beta](https://tendril.opendelta.com/waitlist).**
