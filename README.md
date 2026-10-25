# Ferry

Ferry is a hackathon demo for selling game items through a game's own checkout.
Clerk handles developer sign-in, Postgres stores apps/products/payments, and
Capital One's Nessie simulates the bank.

Clicking **Pay** assumes payment succeeded and deposits the full purchase amount
into Ferry's Nessie account. No payment processor or customer bank account is
used, and the checkout sends no card or shipping data. The recorded commission
is 5%; funds stay in Ferry's account. Amounts are integer cents throughout,
including Nessie, and checkout sessions expire after 10 minutes.

## Run locally

Configure `.env` with `DATABASE_URL`, Clerk keys, `NESSIE_API_KEY`, and
`PUBLIC_BASE_URL=http://localhost:3000`. `NESSIE_BASE_URL` defaults to
`https://api.nessieisreal.com`.

```bash
npm install
npm run db:push
npm run payments:setup
npm run dev
```

Run `db:push` for an existing database too: payments now store the Nessie deposit
ID and settlement time. Review Drizzle's proposed changes before applying them.
`payments:setup` reuses the configured platform account or creates it and saves
`PLATFORM_ACCOUNT_ID` to `.env`. It also prepares app payout accounts; checkout
does not pay them automatically. Restart the server after changing `.env`.

## Try a checkout

Create an application, product, and API key in the dashboard. From your terminal
or game server, create a checkout with that application's key and product ID:

```bash
curl http://localhost:3000/api/v1/checkout/sessions \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"productId":"YOUR_PRODUCT_ID","orderId":"demo-1","playerId":"demo-player","returnUrl":"http://localhost:3000"}'
```

Open the returned `checkoutUrl`, then click **Pay**. The game server can read
`GET /api/v1/orders/demo-1` with the same API key and grant the item when status
is `SUCCEEDED`. Use a new `orderId` to test another purchase.

If Nessie is unavailable, the demo payment still succeeds; use **Retry Nessie
deposit** on checkout to finish settlement. Repeating confirmation reuses the
payment's existing deposit. There is no background retry or webhook delivery.
Retry recovery is best effort: if a timed-out Nessie write is still invisible
when retried, a duplicate deposit is possible.

```bash
node --import tsx --test lib/payments/ledger.test.ts  # local deposit/retry checks
npm run payments:live-test  # creates a demo purchase in your database and Nessie
```

## Code map

| Path                           | Purpose                                      |
| ------------------------------ | -------------------------------------------- |
| `app/checkout/[id]`            | Customer checkout page                       |
| `app/api/v1/checkout/sessions` | Game-server checkout creation                |
| `app/api/v1/orders/[orderId]`  | Authoritative purchase status                |
| `app/api/checkout/[id]`        | Checkout display, confirmation, cancellation |
| `lib/payments/payments.ts`     | Simulated payment and settlement retries     |
| `lib/payments/ledger.ts`       | Tagged Nessie deposits and balances          |
| `lib/schema.ts`                | Tables and uppercase Postgres enums          |

The UI uses shadcn/ui. Add components with `npx shadcn@latest add button`.
