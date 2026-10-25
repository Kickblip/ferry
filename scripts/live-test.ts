/**
 * One purchase through the HTTP API and Nessie, using its own demo app.
 * Run payments:setup and npm run dev first, then npm run payments:live-test.
 */
import "dotenv/config"
import assert from "node:assert/strict"
import crypto from "node:crypto"
import { and, eq } from "drizzle-orm"
import { apps, payouts, products } from "@/lib/schema"
import { generateApiKey, registerApiKey } from "@/lib/payments/api-keys"
import { setupAppPayments } from "@/lib/payments/apps"
import { balanceCents } from "@/lib/payments/ledger"
import { getServices } from "@/lib/payments/services"

const BASE = (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
)

async function api<T>(
  method: string,
  path: string,
  opts: { key?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.key ? { Authorization: `Bearer ${opts.key}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(body)}`)
  return body as T
}

async function main() {
  const svc = await getServices()
  if (!svc.config.platformAccountId) {
    throw new Error("Run npm run payments:setup and restart the server first")
  }
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
  app = await setupAppPayments(svc, app)
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
  const key = generateApiKey()
  await registerApiKey(svc.db, app.id, key, "live test")
  const balances = async () =>
    Promise.all([
      balanceCents(svc.nessie, svc.config.platformAccountId),
      balanceCents(svc.nessie, app.nessieAccountId!),
    ])
  const before = await balances()
  const orderId = `live-${crypto.randomUUID()}`
  const session = await api<{
    id: string
    amountCents: number
    checkoutUrl: string
  }>("POST", "/api/v1/checkout/sessions", {
    key,
    body: {
      productId: product.id,
      orderId,
      playerId: "player-live-1",
      returnUrl: "pixelquest://ferry",
    },
  })
  console.log(`Created checkout ${session.id}: ${session.amountCents} cents`)
  const confirm = () =>
    api<{ status: string; settled: boolean }>(
      "POST",
      `/api/checkout/${session.id}/confirm`
    )
  const confirmations = await Promise.all([confirm(), confirm()])
  assert(confirmations.every((p) => p.status === "SUCCEEDED" && p.settled))

  const order = await api<{ id: string; status: string }>(
    "GET",
    `/api/v1/orders/${encodeURIComponent(orderId)}`,
    { key }
  )
  assert.equal(order.id, session.id)
  assert.equal(order.status, "SUCCEEDED")
  const [payout] = await svc.db
    .select()
    .from(payouts)
    .where(eq(payouts.paymentId, session.id))
  assert.equal(payout, undefined)
  const after = await balances()
  assert.equal(after[0] - before[0], session.amountCents)
  assert.equal(after[1], before[1])
  const deposits = await svc.nessie.listDeposits(svc.config.platformAccountId)
  assert.equal(
    deposits.filter((t) => t.description.split(" ")[0] === session.id).length,
    1
  )
  console.log(
    "Passed: successful demo payment, one full deposit into Ferry, and no automatic payout."
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
