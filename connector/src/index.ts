import { defineConnector } from '@tendril/connector-sdk';
import { agentTools } from './agent-tools.ts';
import { nansenPriceSource } from './price-source.ts';
import { routes } from './routes.ts';
import { NansenConfigSchema, type NansenConfig } from './schemas.ts';

/**
 * Nansen connector for Tendril.
 *
 * A read-only data connector: it brings Nansen's onchain intelligence —
 * smart-money holdings and flows, token market data, token profiles and top
 * holders — into Tendril, where it becomes
 *   - REST endpoints on the Tendril API (`/v1/connectors/nansen/*`),
 *   - a price source for long-tail tokens (NAV, allocation drift, reporting),
 *   - research tools for the Tendril agent.
 *
 * It never moves funds. When the operator acts on Nansen data — buying the
 * picks, moving them into a multisig — Tendril's execution connectors propose
 * the transactions and the operator approves and signs them.
 */
export default defineConnector<NansenConfig>({
  kind: 'nansen',
  name: 'Nansen',
  description: 'Onchain intelligence: smart-money holdings & flows, token market data and holders.',
  category: ['data_provider'],
  version: '0.1.0',
  configSchema: NansenConfigSchema,
  secrets: [{ name: 'NANSEN_API_KEY', description: 'Nansen API key (app.nansen.ai/api)', required: true }],

  capabilities: (config) => {
    const scope = { chains: config.chains };
    return [
      { type: 'data.smart_money', scope },
      { type: 'data.token_screener', scope },
      { type: 'data.token_holders', scope },
      { type: 'data.market', scope },
    ];
  },

  routes,
  priceSource: nansenPriceSource,
  agentTools,
});
