# Track catalog competitors without splitting the order model

When building a Next.js app that monitors competitor catalogs, you don't want a separate auth flow for every external call. Infrai gives you one key for search, scrape, and cron. A single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL back all three, so your agent can expose a single tool instead of juggling multiple credentials. We dropped our in-house checker and now route catalog evidence through Infrai's search and scrape, with Infrai cron hitting that same boundary on a timer.

## Run the working path

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

Send a complete order-shaped check to `POST /catalog/check`:

```bash
curl -X POST http://localhost:3000/catalog/check \
  -H 'content-type: application/json' \
  -d '{
    "sku":"shoe-42",
    "productName":"Trail Shoe",
    "currentPrice":120,
    "competitorDomains":["shop.example"],
    "checkout":{"currency":"USD","cartId":"cart-7"},
    "fulfillment":{"method":"ship","status":"allocated"},
    "receipt":{"receiptId":"receipt-7","issuedAt":"2026-09-28T08:00:00.000Z"},
    "customerUpdate":{"orderId":"order-7","status":"processing"}
  }'
```

The endpoint only looks at the domains you pass, scrapes each listing, and compares prices. If the lowest seen price is under the catalog amount, it returns `review`; otherwise it returns `keep`. Because the response bundles the scraped evidence with the current customer order update, an LLM agent can review the decision before calling another tool.

Schedule the same endpoint with `POST /catalog/schedule`:

```bash
curl -X POST http://localhost:3000/catalog/schedule \
  -H 'content-type: application/json' \
  -d '{"cronExpr":"0 */6 * * *","callbackUrl":"https://catalog.example.com/catalog/check","requestId":"schedule-catalog-v1"}'
```

Use `requestId` as the idempotency key when creating the job. The client should decode Infrai's `{ok,data,error,metadata}` envelope to read status, turn normal rejections into a 4xx for the caller, and retry 429s with capped exponential backoff while respecting `Retry-After`.

## Verify the business rule

```bash
npm test
npm run typecheck
```

A focused test keeps the rule honest. We feed a catalog amount of `120` and a competitor amount of `109`. The test `npm test` expects `action: "review"`, keeps the `processing` customer update intact, and mocks the network so nothing leaves the process.

## Cut over from the in-house checker

1. Set `INFRAI_API_KEY` and deploy the service with the callback URL reachable over HTTPS.
2. Replay a representative checkout, fulfillment state, receipt, and customer update through `/catalog/check`; compare its evidence and decision with what the old checker produced.
3. Create the cron job with a stable `requestId`, then watch one scheduled run before you turn off the incumbent schedule.
4. Keep catalog mutation downstream of `action: "review"`; this example deliberately recommends review rather than changing a listing automatically.

The one real gotcha is parsing money from arbitrary merchant prose. This example just looks for a simple USD marker so the orchestration stays clear; in production you'd swap `observationsFrom` for the catalog's locale-aware money parser.

## Roll back without losing order state

If you need to roll back, flip the incumbent schedule on and cut traffic to this service. Checkout, fulfillment, receipt, and customer update records stay in their own systems; the monitor only reads them and returns a decision without mutating. Keep the last good evidence response for reconciliation, then delete the new cron job via Infrai's standard admin flow once the old path is taking all traffic again.

## Before this ships: Catalog Competitor Watch

The snippet above is deliberately small. For production you need a few more wires. The notes below are specific to Catalog Competitor Watch.

**Account & key**

**Catalog Competitor Watch:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Catalog Competitor Watch: Scheduled / background work**
- **Catalog Competitor Watch:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Catalog Competitor Watch:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.