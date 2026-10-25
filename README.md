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

Run `db:push` for an existing database too: payments store the Nessie deposit
ID and settlement time, and webhook settings and delivery history need their
database fields. Review Drizzle's proposed changes before applying them.
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
payment's existing deposit. There is no background settlement retry.
Retry recovery is best effort: if a timed-out Nessie write is still invisible
when retried, a duplicate deposit is possible.

```bash
node --import tsx --test lib/payments/webhook*.test.ts  # local webhook checks
npm run payments:live-test  # creates a demo purchase in your database and Nessie
```

## Webhooks

Open **Webhooks** below **API Keys**, save a public HTTPS callback URL, and copy
the signing key into your server's configuration. Editing the URL keeps the key.
Use an HTTPS tunnel when testing a receiver on your own machine.

After checkout succeeds, Ferry sends a POST with
`{ id, type: "payment.succeeded", createdAt, data }`. `data` contains the payment
details, including `orderId`, `playerId`, `productId`, and `simulated: true`.
The event is sent even if the Nessie deposit is pending. The page lists the
latest 50 calls and their HTTP results; reload it to see new calls.

Verify the `X-Ferry-Signature` header, formatted `t=<unix-seconds>,v1=<hex>`.
Using the signing key exactly as displayed, compute HMAC-SHA256 over
`<timestamp>.<raw request body>` and compare the digest with `v1` using a
constant-time comparison. Reject timestamps more than five minutes old (or in
the future) and deduplicate the event `id` before granting a purchase. Verify
the raw body before parsing JSON.

Delivery runs after the checkout response, with one attempt and a five-second
timeout. A 2xx response counts as delivered; redirects and other responses fail.
There is no retry worker; receiver failures do not undo the payment. A server
interruption can leave a delivery pending or prevent it from being recorded, so
the authenticated order-status endpoint remains available to verify purchases.

## Code map

| Path                             | Purpose                                      |
| -------------------------------- | -------------------------------------------- |
| `app/checkout/[id]`              | Customer checkout page                       |
| `app/api/v1/checkout/sessions`   | Game-server checkout creation                |
| `app/api/v1/orders/[orderId]`    | Authoritative purchase status                |
| `app/api/checkout/[id]`          | Checkout display, confirmation, cancellation |
| `app/dashboard/[appId]/webhooks` | Callback settings and recent deliveries      |
| `app/api/apps/[appId]/webhook`   | Owner-only callback settings                 |
| `lib/payments/webhooks.ts`       | Signed payment-success notifications         |
| `lib/payments/payments.ts`       | Simulated payment and settlement retries     |
| `lib/payments/ledger.ts`         | Tagged Nessie deposits and balances          |
| `lib/schema.ts`                  | Tables and uppercase Postgres enums          |

The UI uses shadcn/ui. Add components with `npx shadcn@latest add button`.
