/**
 * End-to-end purchase through the real HTTP API and real Nessie, narrated step
 * by step. Plays three roles: the game's server (API key), the checkout page
 * (public endpoints) and a webhook receiver (a tiny local "game server").
 *
 * Uses its own "Ferry Live Test" app so teammates' apps are never touched.
 * Needs `npm run dev` running and `npm run payments:setup` done.
 *
 * Usage: npm run payments:live-test
 */
import "dotenv/config"
import http from "node:http"
import { and, eq } from "drizzle-orm"
import { apps, products } from "@/lib/schema"
import { generateApiKey, registerApiKey } from "@/lib/payments/api-keys"
import { balanceCents } from "@/lib/payments/ledger"
import { getServices } from "@/lib/payments/services"
import { SIGNATURE_HEADER, verifyWebhook } from "@/lib/payments/webhooks"

const BASE = (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
)
const WEBHOOK_PORT = 4100
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const step = (n: number, title: string) => console.log(`\n── ${n}. ${title}`)
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function api<T>(
  method: string,
  path: string,
  opts: { key?: string; body?: unknown } = {}
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const body = (await res.json()) as T
  console.log(`   ${method} ${path} → ${res.status}`)
  if (!res.ok)
    throw new Error(`${method} ${path} failed: ${JSON.stringify(body)}`)
  return body
}

async function main() {
  const svc = await getServices()
  const unit = svc.config.nessieAmountUnit

  step(0, "Waiting for the Ferry server")
  for (let i = 0; ; i++) {
    try {
      await fetch(`${BASE}/api/checkout/00000000-0000-0000-0000-000000000000`)
      break
    } catch {
      if (i > 90)
        throw new Error(
          `Ferry isn't reachable at ${BASE}. Run npm run dev first.`
        )
      await wait(1000)
    }
  }
  console.log(`   Ferry is up at ${BASE}`)

  step(1, "Test app, product and API key (what the dashboard will do)")
  let [app] = await svc.db
    .select()
    .from(apps)
    .where(eq(apps.ownerId, "ferry-live-test"))
  if (!app) {
    ;[app] = await svc.db
      .insert(apps)
      .values({ ownerId: "ferry-live-test", name: "Ferry Live Test" })
      .returning()
  }
  let [product] = await svc.db
    .select()
    .from(products)
    .where(and(eq(products.appId, app.id), eq(products.name, "Live Test Gems")))
  if (!product) {
    ;[product] = await svc.db
      .insert(products)
      .values({ appId: app.id, name: "Live Test Gems", price: 499 })
      .returning()
  }
  const apiKey = generateApiKey()
  await registerApiKey(svc.db, app.id, apiKey, "live test")
  console.log(
    `   app ${app.id} · product "${product.name}" ${money(product.price)} · key ${apiKey.slice(0, 12)}…`
  )

  step(2, "A stand-in game server to receive webhooks")
  const received: { type: string; paymentId: string; verified: boolean }[] = []
  let webhookSecret = ""
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const verified = verifyWebhook(
        webhookSecret,
        req.headers[SIGNATURE_HEADER.toLowerCase()] as string,
        raw
      )
      const event = JSON.parse(raw)
      received.push({
        type: event.type,
        paymentId: event.data.payment.id,
        verified,
      })
      console.log(
        `   ⇦ webhook ${event.type} for ${event.data.payment.id} · signature ${verified ? "VALID" : "INVALID"}`
      )
      res.writeHead(verified ? 200 : 400).end()
    })
  })
  await new Promise<void>((r) => server.listen(WEBHOOK_PORT, r))
  await api("PATCH", "/api/v1/settings", {
    key: apiKey,
    body: { webhookUrl: `http://localhost:${WEBHOOK_PORT}/webhook` },
  })
  ;({ webhookSecret } = await api<{ webhookSecret: string }>(
    "POST",
    "/api/v1/settings/webhook-secret",
    { key: apiKey }
  ))
  console.log(
    `   listening on :${WEBHOOK_PORT}, secret ${webhookSecret.slice(0, 10)}…`
  )

  step(3, "Game server → Ferry: start a checkout")
  const orderId = `live-${Date.now()}`
  const session = await api<{
    id: string
    status: string
    amountCents: number
    feeCents: number
    netCents: number
    checkoutUrl: string
  }>("POST", "/api/v1/checkout/sessions", {
    key: apiKey,
    body: {
      productId: product.id,
      orderId,
      playerId: "player-live-1",
      returnUrl: "pixelquest://ferry",
    },
  })
  console.log(
    `   payment ${session.id} · ${session.status} · charge ${money(session.amountCents)} = fee ${money(session.feeCents)} + developer ${money(session.netCents)}`
  )
  console.log(`   checkoutUrl ${session.checkoutUrl}`)

  ;[app] = await svc.db.select().from(apps).where(eq(apps.id, app.id))
  const methods = await api<{ data: { id: string; label: string }[] }>(
    "GET",
    `/api/checkout/${session.id}/payment-methods`
  )
  const method = methods.data.find((m) => m.label === "Demo Player 1")!
  const { payerAccounts } = await import("@/lib/schema")
  const { paymentMethodId } = await import("@/lib/payments/payments")
  const payerAccountId = (await svc.db.select().from(payerAccounts)).find(
    (p) => paymentMethodId(p.nessieAccountId) === method.id
  )!.nessieAccountId
  const accounts = {
    player: payerAccountId,
    platform: svc.config.platformAccountId,
    developer: app.nessieAccountId!,
  }
  const balances = async () =>
    Object.fromEntries(
      await Promise.all(
        Object.entries(accounts).map(async ([k, id]) => [
          k,
          await balanceCents(svc.nessie, id, unit),
        ])
      )
    ) as Record<keyof typeof accounts, number>
  const before = await balances()
  console.log(
    `   (server-side only) balances before: player ${money(before.player)} · platform ${money(before.platform)} · developer ${money(before.developer)}`
  )

  step(4, "Checkout page → Ferry: load the session and payment methods")
  const view = await api<{
    merchant: { name: string }
    description: string
    amountCents: number
  }>("GET", `/api/checkout/${session.id}`)
  console.log(
    `   shows "${view.description}" from ${view.merchant.name} for ${money(view.amountCents)}`
  )
  console.log(
    `   payment methods: ${methods.data.map((m) => `${m.label} (${m.id.slice(0, 10)}…)`).join(", ")}`
  )

  step(5, "Player taps Pay (twice, like a double-click)")
  const [first, second] = await Promise.all([
    api<{ status: string; returnUrl: string | null }>(
      "POST",
      `/api/checkout/${session.id}/confirm`,
      { body: { paymentMethodId: method.id } }
    ),
    api<{ status: string }>("POST", `/api/checkout/${session.id}/confirm`, {
      body: { paymentMethodId: method.id },
    }),
  ])
  console.log(`   responses: ${first.status} / ${second.status}`)
  let status = first.status
  for (let i = 0; status === "processing" && i < 30; i++) {
    await wait(1000)
    status = (
      await api<{ status: string }>("GET", `/api/checkout/${session.id}`)
    ).status
  }
  const final = await api<{ status: string; returnUrl: string | null }>(
    "GET",
    `/api/checkout/${session.id}`
  )
  console.log(`   final: ${final.status} · send player to ${final.returnUrl}`)

  step(6, "Background worker: developer payout + webhook (polling up to 30 s)")
  let payout: { status: string; amountCents: number } | undefined
  for (
    let i = 0;
    i < 30 && (payout?.status !== "paid" || !received.length);
    i++
  ) {
    await wait(1000)
    payout = (
      await api<{
        data: { paymentId: string; status: string; amountCents: number }[]
      }>("GET", "/api/v1/payouts", { key: apiKey })
    ).data.find((p) => p.paymentId === session.id)
  }
  console.log(
    `   payout ${payout?.status} ${payout ? money(payout.amountCents) : ""}`
  )

  step(7, "Checks")
  const after = await balances()
  const delta = {
    player: after.player - before.player,
    platform: after.platform - before.platform,
    developer: after.developer - before.developer,
  }
  const withdrawals = (
    await svc.nessie.listWithdrawals(accounts.player)
  ).filter((t) => t.description.startsWith(session.id))
  const order = await api<{ status: string }>(
    "GET",
    `/api/v1/orders/${orderId}`,
    { key: apiKey }
  )
  const balance = await api<{ availableCents: number }>(
    "GET",
    "/api/v1/balance",
    { key: apiKey }
  )
  const checks: [string, boolean][] = [
    [`payment succeeded`, final.status === "succeeded"],
    [
      `player charged ${money(-delta.player)} (expected $4.99)`,
      delta.player === -499,
    ],
    [
      `platform kept ${money(delta.platform)} fee (expected $0.25)`,
      delta.platform === 25,
    ],
    [
      `developer received ${money(delta.developer)} (expected $4.74)`,
      delta.developer === 474,
    ],
    [
      `exactly one withdrawal from the player (found ${withdrawals.length})`,
      withdrawals.length === 1,
    ],
    [`payout marked paid`, payout?.status === "paid"],
    [
      `webhook received and signature valid`,
      received.some(
        (w) =>
          w.paymentId === session.id &&
          w.type === "payment.succeeded" &&
          w.verified
      ),
    ],
    [`order lookup says succeeded`, order.status === "succeeded"],
    [
      `developer balance endpoint ${money(balance.availableCents)}`,
      balance.availableCents === after.developer,
    ],
  ]
  for (const [label, ok] of checks) console.log(`   ${ok ? "✔" : "✘"} ${label}`)
  server.close()
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
