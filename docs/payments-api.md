# Ferry Payments API

Ferry lets a game sell in-app items through **Ferry's checkout** (opened in an in-app browser) instead of
Apple's In-App Purchase. Money moves through **Capital One's Nessie** sandbox. This doc is the contract
between the payments API and everything that uses it:

| Who | Uses |
|---|---|
| A game's **server** | [Game-server API](#game-server-api) (secret API key) + [webhooks](#webhooks) |
| The **checkout page** (purchase interface) | [Checkout API](#checkout-api) (no key; the payment id is the access token) |
| The **dashboard** (API keys, settings, history) | [Dashboard hook-ups](#dashboard-hook-ups) (server-side functions) |

All amounts are **integer cents** (`499` = $4.99). All errors look like
`{ "error": { "code": "order_conflict", "message": "…" } }` with a matching HTTP status.

---

## How a purchase flows

```
Game app ──"buy 550 Gems"──▶ Game server ──POST /api/v1/checkout/sessions──▶ Ferry
Game app ◀──── checkoutUrl ── Game server ◀─────────── { id, checkoutUrl } ──┘
Game app opens checkoutUrl in an in-app browser ──▶ Checkout page (Ferry)
Checkout page ──POST /api/checkout/{id}/confirm { paymentMethodId }──▶ Ferry
     Ferry: player ──Nessie──▶ Ferry platform account     → status "succeeded"
Checkout page ──redirect to returnUrl──▶ Game app (closes the browser)
     Ferry (background): platform ──Nessie──▶ developer account (minus fee)
     Ferry ──signed webhook payment.succeeded──▶ Game server ──grants the item once
```

Fee example (5%, `PLATFORM_FEE_BPS=500`): a $4.99 product charges the player **499**, Ferry keeps **25**,
the developer is paid **474**.

### Payment statuses

`requires_confirmation` → (player confirms) → `processing` → `succeeded` | `failed`.
Unconfirmed sessions become `expired` after 30 minutes, or `canceled` if the player backs out.
`processing` usually lasts milliseconds; if Nessie is slow or down it's retried in the background.

---

## Game-server API

Base: `https://<ferry host>/api/v1`. Send the app's secret key on every request:
`Authorization: Bearer sk_test_…`. **Call this from your server, never from the game client.**

### `POST /checkout/sessions` — start a checkout

```json
{
  "productId": "5c0f…-uuid",       // one of your app's products; its price is charged
  "orderId": "order-8812",          // your id for this purchase (idempotency key)
  "playerId": "player-42",
  "returnUrl": "pixelquest://ferry", // optional: where the checkout sends the player afterwards
  "metadata": { "sku": "gems_550" }  // optional, echoed back in webhooks
}
```

`201 Created` (or `200` when the order already has an active session — same response, same id):

```json
{
  "id": "0b6e…", "orderId": "order-8812", "productId": "5c0f…", "playerId": "player-42",
  "description": "550 Gems", "amountCents": 499, "feeCents": 25, "netCents": 474,
  "currency": "usd", "status": "requires_confirmation",
  "checkoutUrl": "https://<ferry host>/checkout/0b6e…",
  "expiresAt": "…", "createdAt": "…", "confirmedAt": null, "succeededAt": null,
  "failureCode": null, "failureMessage": null, "metadata": { "sku": "gems_550" }
}
```

- The **price comes from the product in Ferry's database**, never from the request.
- Repeating the call with the same `orderId` returns the existing session (safe to retry on timeouts).
  If that attempt failed/expired/was canceled, a new attempt is created.
- Same `orderId` with a different product or player → `409 order_conflict`.
- Other errors: `401 missing_api_key | invalid_api_key`, `404 product_not_found`, `400 invalid_request`.

### Reading payments

| Endpoint | Returns |
|---|---|
| `GET /checkout/sessions/{id}` | the payment (same shape as above) |
| `GET /orders/{orderId}` | latest payment for your order — **use this if a webhook never arrives** |
| `GET /payments?status=succeeded&limit=25&before=<ISO>` | `{ data: Payment[] }`, newest first |
| `GET /payments/{id}` | one payment |
| `GET /payouts` | `{ data: [{ id, paymentId, amountCents, status, attempts, createdAt, paidAt, depositId }] }` — your share of each payment; `depositId` is the deposit into **your** Nessie account |
| `GET /balance` | `{ availableCents, pendingPayoutCents, currency }` |
| `GET /webhook-deliveries` | `{ data: Delivery[] }` — every webhook sent and its result |
| `POST /webhook-deliveries/{id}/retry` | re-queues a webhook (e.g. after fixing your endpoint) |

### Settings

| Endpoint | Does |
|---|---|
| `GET /settings` | `{ appId, name, nessieAccountId, webhookUrl, hasWebhookSecret, feeBps }` |
| `PATCH /settings` `{ "webhookUrl": "https://…" }` | sets (or with `null` removes) your webhook URL |
| `POST /settings/webhook-secret` | `{ webhookSecret }` — new signing secret, **shown once** |

---

## Webhooks

When a payment finishes, Ferry POSTs to the app's `webhookUrl`:

```json
{ "id": "evt_…", "type": "payment.succeeded", "created": "…", "data": { "payment": { …Payment } } }
```

Types: `payment.succeeded`, `payment.failed`. Header `X-Ferry-Signature: t=<unix>,v1=<hex>` where
`v1 = HMAC-SHA256(webhookSecret, "<t>.<raw body>")`. Respond with any `2xx` within 10 s; otherwise Ferry
retries with backoff (5 s, 15 s, 1 m, 5 m, 15 m, 30 m, then hourly), up to 8 attempts.

**Verify before trusting it, and grant each payment only once** (webhooks can repeat):

```ts
import crypto from "node:crypto"

function verifyFerryWebhook(secret: string, header: string | null, rawBody: string) {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=")))
  const t = Number(parts.t)
  if (!parts.v1 || Math.abs(Date.now() / 1000 - t) > 300) return false // stale or missing
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")
  return expected.length === parts.v1.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))
}

// In your handler: read the RAW body (not re-serialized JSON), verify, then
// if (event.type === "payment.succeeded" && !alreadyGranted(event.data.payment.id)) grantItem(…)
```

---

## Checkout API

For the player-facing purchase page at `/checkout/{id}` (path configurable with `CHECKOUT_PATH`). No API key:
the unguessable payment id in the URL is the access token, and these endpoints never expose secrets.

| Endpoint | Does |
|---|---|
| `GET /api/checkout/{id}` | the session for display (below). Poll every ~1 s while `processing`. |
| `GET /api/checkout/{id}/payment-methods` | `{ data: [{ id: "pm_…", label: "Demo Player 1" }] }` — the player's saved payment methods |
| `POST /api/checkout/{id}/confirm` `{ "paymentMethodId": "pm_…" }` | pays. Usually returns `succeeded`/`failed` immediately. Safe to double-click. |
| `POST /api/checkout/{id}/cancel` | player backs out (only before paying) |

Session view:

```json
{
  "id": "0b6e…", "status": "succeeded", "amountCents": 499, "currency": "usd",
  "description": "550 Gems", "merchant": { "name": "Pixel Quest" },
  "expiresAt": "…", "failureCode": null, "failureMessage": null,
  "checkoutUrl": "https://…/checkout/0b6e…",
  "returnUrl": "pixelquest://ferry?payment_id=0b6e…&status=succeeded"
}
```

- When `returnUrl` is non-null the payment is final: send the player there (it closes the in-app browser
  and returns to the game). The game should then **ask its own server**, not trust the URL.
- `failureCode` / `failureMessage` on a declined payment: `insufficient_funds` ("The payment was declined"),
  `nessie_rejected` ("The payment was declined by the bank"), `nessie_unavailable` ("The bank is unavailable right now…").
  Show the message; the player can pick another payment method and try a new checkout.
- Confirm errors: `410 session_expired`, `400 unknown_payment_method`, `404 payment_not_found`.

Hackathon note: Nessie is a simulated bank with no card processing, so instead of a card form the page lets
the player pick one of the pre-made demo accounts (created by `npm run payments:setup`). They're presented like
saved cards — a label and an opaque `pm_…` id — and **never show balances or account numbers** (see Privacy).

---

## Privacy

Ferry follows how real payment processors work, even though Nessie is a simulation:

- **Developers never see the player's bank details.** Payments, webhooks and history contain Ferry's own
  payment id, the amount and the outcome — no player account ids, balances or bank transaction ids.
- **The checkout page never sees balances or account numbers.** Payment methods are opaque `pm_…` ids;
  only Ferry's server maps them to Nessie accounts.
- **Funds are checked server-side only.** A shortfall comes back as a decline code (`insufficient_funds`),
  never as an amount — like a card being declined.
- Raw Nessie errors (which name internal accounts) are kept in Ferry's database for debugging and never
  returned by the API.
- Developers do see their **own** payout deposits (`depositId`) — that's their bank account.

`tests/privacy.test.ts` checks every developer- and checkout-facing response and webhook for leaks.

---

## Dashboard hook-ups

The dashboard runs on Ferry's server with Clerk, so it calls library functions directly (after checking the
signed-in user owns the app — `apps.ownerId === userId`):

**API keys** (`lib/payments/api-keys.ts`) — key generation is the dashboard's job; storage and checking are here.

```ts
import { generateApiKey, registerApiKey, revokeApiKey } from "@/lib/payments/api-keys"
import { db } from "@/lib/db"

const key = generateApiKey()                         // or your own: must start with "sk_", 24+ chars
const record = await registerApiKey(db, appId, key, "Production server")
// Show `key` to the developer ONCE. Only its SHA-256 hash is stored (api_keys table).
// List keys: select id, prefix, label, createdAt, revokedAt from api_keys where appId = …
await revokeApiKey(db, appId, record.id)
```

**History and settings** — `lib/payments/queries.ts` (`listPayments`, `listPayouts`, `listDeliveries`,
`appBalanceCents`) and `lib/payments/apps.ts` (`updatePaymentSettings`, `rotateWebhookSecret`), each taking
`await getServices()` from `lib/payments/services.ts`. Shapes for display: `lib/payments/views.ts`.

---

## Running it

```bash
npm run db:push            # create the payment tables (once, and after schema changes)
npm run payments:setup     # create Nessie platform + demo player accounts (writes PLATFORM_ACCOUNT_ID)
npm run payments:test-key  # list apps; then: npm run payments:test-key -- <appId>
npm run payments:live-test # real end-to-end purchase via HTTP + Nessie (needs npm run dev)
npm run dev                # also starts the background worker (payouts, retries, webhooks)
npm test                   # 29 tests: real Postgres in memory (PGlite) + a fake Nessie
```

Environment (`.env`): `NESSIE_API_KEY`, `NESSIE_BASE_URL`, `NESSIE_AMOUNT_UNIT=cents`, `PLATFORM_ACCOUNT_ID`,
`PLATFORM_FEE_BPS`, `PUBLIC_BASE_URL`, `INTERNAL_TOKEN`, plus Ferry's `DATABASE_URL` and Clerk keys.
On serverless hosting nothing runs between requests: point a cron at
`POST /api/internal/tick` with `Authorization: Bearer $INTERNAL_TOKEN`.

### How Nessie is used (and why)

Nessie (Oct 2026, per its OpenAPI spec and live tests) has **no account-to-account transfer endpoint**,
returns **no ids from create calls**, **never updates stored balances**, and stores **whole-number amounts**.
So Ferry:

- moves money as a **withdrawal** from the source plus a **deposit** to the destination, each tagged
  `"<ref> …"` in its description;
- before every write, **looks for a transaction already tagged with that ref** — so a retry after a timeout
  never charges twice;
- computes balances as **opening balance + deposits − withdrawals**;
- records amounts in **cents** (`NESSIE_AMOUNT_UNIT=cents`) so $0.99 items work.
