# `@tendril/connector-sdk` — preview

The interface a Tendril connector is written against. **Not published yet** — this folder documents the
contract so you can see what writing a connector looks like. Names and shapes may change before release.

```ts
import { defineConnector } from '@tendril/connector-sdk';

export default defineConnector({
  kind: 'my-data-provider',
  name: 'My Data Provider',
  description: 'What it brings to Tendril',
  category: ['data_provider'],
  version: '0.1.0',
  configSchema, // validates the instance config
  secrets: [{ name: 'MY_API_KEY', description: '…', required: true }],
  capabilities: (config) => [{ type: 'data.market', scope: { chains: config.chains } }],
  routes: [/* read-only data routes → /v1/connectors/my-data-provider/… */],
  priceSource: /* optional: plug into Tendril pricing */ undefined,
  agentTools: [/* optional: research tools for the Tendril agent */],
});
```

| Export | Purpose |
| --- | --- |
| `defineConnector` | Declares a connector with full type inference. |
| `ConnectorContext` | What Tendril hands every hook: validated config, secrets, the asset directory, egress-controlled `fetch`, logger, clock. |
| `DataRoute` | A read-only REST route; input/output schemas become the OpenAPI entry. |
| `PriceSourceDefinition` | Spot and historical prices, plus a registration-time "can you price this?" probe. |
| `AgentToolDefinition` | A read-only tool for the Tendril agent (JSON-Schema input, model-facing description). |
| `ConnectorError` | Maps upstream failures onto clean API errors. |
| `AssetRef`, `CapabilityDeclaration`, … | Shared shapes. |

The full types are in [`src/index.ts`](src/index.ts). The model behind them — capabilities, scope, the
propose → approve → sign boundary — is described in [../docs/connector-model.md](../docs/connector-model.md).
The [Nansen connector](../connector/src/index.ts) is a complete example.

**This preview covers data connectors** (read-only). Execution connectors follow the same model and always hand
their transactions to Tendril's approval and signing pipeline.

Want early access? [Join the waitlist](https://tendril.opendelta.com/waitlist).
