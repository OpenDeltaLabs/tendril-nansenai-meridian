# Calling the Nansen connector through the Tendril API

Once the connector is enabled in your workspace, its data routes are part of the Tendril API. Access requires a
Tendril API key — the API is in closed beta ([waitlist](https://tendril.opendelta.com/waitlist)). Endpoint paths
follow the connector SDK convention `/v1/connectors/{kind}/{path}` and may change before general availability.

```bash
export TENDRIL_API_URL="https://<your-tendril-api>"
export TENDRIL_API_KEY="…"   # a Tendril key, not your Nansen key — that one lives in the connector's secrets
```

## Top smart-money holdings, per chain

```bash
curl "$TENDRIL_API_URL/v1/connectors/nansen/smart-money/holdings?chains=solana,base&limitPerChain=3" \
  -H "Authorization: Bearer $TENDRIL_API_KEY"
```

```jsonc
{
  "asOf": "2026-09-24T14:46:20.000Z",
  "source": "nansen",
  "data": [
    {
      "chain": "solana",
      "rank": 1,
      "symbol": "STONK",
      "tokenAddress": "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx",
      "tendrilAssetId": null,            // not registered in this workspace yet
      "sectors": ["Memecoins"],
      "smartMoneyValueUsd": 47640000,
      "smartMoneyHolders": 152,
      "smartMoneyBalanceChange24hPct": -0.05,
      "shareOfSmartMoneyHoldingsPct": 11.22,
      "marketCapUsd": 307230000
    }
    // …
  ]
}
```

Percentages are real percentages (`11.22` = 11.22%) — the connector converts Nansen's fractions.

## Price and market cap for tokens you hold

```bash
curl "$TENDRIL_API_URL/v1/connectors/nansen/tokens/market-data?assetIds=asset_pump_solana,asset_aero_base" \
  -H "Authorization: Bearer $TENDRIL_API_KEY"
```

One Nansen call per chain, however many tokens you ask for. Tokens Nansen has no data for come back in
`missing`.

## What smart money is buying

```bash
curl "$TENDRIL_API_URL/v1/connectors/nansen/smart-money/netflow?chains=base&limitPerChain=10" \
  -H "Authorization: Bearer $TENDRIL_API_KEY"
```

## Who holds a token

```bash
curl "$TENDRIL_API_URL/v1/connectors/nansen/tokens/holders?chain=base&tokenAddress=0x940181a94a35a4569e4529a3cdfb74e38fd98631&label=smart_money" \
  -H "Authorization: Bearer $TENDRIL_API_KEY"
```

## Or ask the agent

With the connector enabled, the Tendril agent uses the same routes as tools. In the Tendril app, or through the
agent endpoint of the API:

> Use Nansen to find the top 3 smart-money holdings on Base and Solana, and weight them by market cap with no
> token above 50%.

The agent answers with the ranking, the weights and anything worth flagging — and proposes, never executes,
whatever you decide to do next.
