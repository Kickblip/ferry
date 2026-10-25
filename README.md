# Ferry

Ferry is a hackathon demo for selling game items through a game's own checkout.
Clerk handles developer sign-in, Postgres stores apps/products/payments, and
Capital One's Nessie simulates the bank.

A purchase runs in one confirmation request: charge the player, record the
payment, and attempt the developer payout. Amounts are integer cents, the fee
is 5%, and checkout sessions expire after 10 minutes.

## Run locally

Install dependencies and configure `.env` with `DATABASE_URL`, Clerk keys,
`NESSIE_API_KEY`, and `PUBLIC_BASE_URL=http://localhost:3000`.
`NESSIE_BASE_URL` defaults to `https://api.nessieisreal.com`.

For a **new database**:

```bash
npm install
npm run db:push
npm run payments:setup
npm run dev
```

For an **existing database from the previous payments branch**, stop the old
server/worker and run [scripts/migrate-payment-enums.sql](scripts/migrate-payment-enums.sql)
once before starting this version. It converts existing values to uppercase
Postgres enums and preserves historical removed fields/tables. A later
`db:push` may propose deleting that unused historical data; review its prompt.

`payments:setup` creates the platform account and demo payer accounts, saves
`PLATFORM_ACCOUNT_ID` to `.env`, and prepares payout accounts for existing
applications. New applications get their payout account when created in the
dashboard. Restart the server after changing `.env`.

```bash
npm run payments:test-key             # list applications
npm run payments:test-key -- <appId>   # generate an API key
npm test                              # in-memory Postgres + fake bank
npm run payments:live-test            # purchase via running server and Nessie
```

## Demo flow

1. The game server creates a checkout with its API key and a Ferry product ID.
2. The checkout calls the public confirmation endpoint with a demo payment method.
3. Ferry charges the player and attempts the payout in that request.
4. The game server reads the order endpoint and grants the item once the status
   is `SUCCEEDED`.

There is no worker, cron, webhook delivery system, or automatic retry. A
`PROCESSING` payment can be resumed by explicitly repeating confirmation with
the original payment method. A successful payment with an unfinished payout
can also be confirmed again to retry only the payout.

The payment API is implemented; the browser page at `/checkout/[id]` still
needs to be built. The live-test script exercises the API directly.

Full request/response details: [Payments API](docs/payments-api.md).

## Code map

| Path                           | Purpose                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `app/dashboard`                | Developer dashboard                                           |
| `app/api/apps`                 | Clerk-authenticated app/product creation                      |
| `app/api/v1/checkout/sessions` | Game-server checkout creation                                 |
| `app/api/v1/orders/[orderId]`  | Authoritative purchase status for the game server             |
| `app/api/checkout/[id]`        | Checkout display, payment methods, confirmation, cancellation |
| `lib/payments/payments.ts`     | Purchase flow and explicit retries                            |
| `lib/payments/ledger.ts`       | Tagged withdrawal/deposit pairs and balances                  |
| `lib/payments/nessie`          | Bank HTTP client and test fake                                |
| `lib/schema.ts`                | Tables and uppercase Postgres enums                           |

The UI uses shadcn/ui. Add components with `npx shadcn@latest add button`.
