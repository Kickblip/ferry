import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { POST as createSession } from "@/app/api/v1/checkout/sessions/route"
import { GET as getSession } from "@/app/api/v1/checkout/sessions/[id]/route"
import { GET as getOrder } from "@/app/api/v1/orders/[orderId]/route"
import { GET as listPayments } from "@/app/api/v1/payments/route"
import { GET as listPayouts } from "@/app/api/v1/payouts/route"
import { GET as getCheckout } from "@/app/api/checkout/[id]/route"
import { GET as getPaymentMethods } from "@/app/api/checkout/[id]/payment-methods/route"
import { POST as confirm } from "@/app/api/checkout/[id]/confirm/route"
import { POST as tickRoute } from "@/app/api/internal/tick/route"
import { apps, products } from "@/lib/schema"
import { revokeApiKey } from "@/lib/payments/api-keys"
import { paymentMethodId } from "@/lib/payments/payments"
import { apiKeys } from "@/lib/schema"
import { tick } from "@/lib/payments/worker"
import { createHarness, fakeBalance, type Harness } from "./harness"

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.close()
})

const order = (orderId = "order-1", playerId = "player-42") => ({
  productId: h.product.id,
  orderId,
  playerId,
})

describe("checkout happy path", () => {
  it("charges the player, pays the developer, and sends a signed webhook", async () => {
    // 1. Game server creates a checkout; the price comes from the product, not the request.
    const created = await h.call<{
      id: string
      amountCents: number
      feeCents: number
      netCents: number
      status: string
      checkoutUrl: string
    }>(createSession, { body: { ...order(), returnUrl: "pixelquest://ferry" } })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      amountCents: 499,
      feeCents: 25,
      netCents: 474,
      status: "requires_confirmation",
    })
    expect(created.body.checkoutUrl).toBe(
      `https://ferry.test/checkout/${created.body.id}`
    )
    const id = created.body.id

    // 2. Checkout page loads the session and the saved payment methods.
    const page = await h.call<{
      merchant: { name: string }
      amountCents: number
      returnUrl: string | null
    }>(getCheckout, {
      key: null,
      params: { id },
    })
    expect(page.body).toMatchObject({
      merchant: { name: "Pixel Quest" },
      amountCents: 499,
      returnUrl: null,
    })
    const methods = await h.call<{ data: { id: string; label: string }[] }>(
      getPaymentMethods,
      { key: null, params: { id } }
    )
    expect(methods.body.data).toContainEqual({
      id: paymentMethodId(h.playerAccountId),
      label: "Demo Player 1",
    })

    // 3. Player confirms: money moves player → platform in Nessie, synchronously.
    const paid = await h.call<{ status: string; returnUrl: string }>(confirm, {
      key: null,
      params: { id },
      body: { paymentMethodId: paymentMethodId(h.playerAccountId) },
    })
    expect(paid.body.status).toBe("succeeded")
    expect(paid.body.returnUrl).toBe(
      `pixelquest://ferry?payment_id=${id}&status=succeeded`
    )
    expect(fakeBalance(h.nessie, h.playerAccountId)).toBe(50_000 - 499)
    expect(fakeBalance(h.nessie, h.platformAccountId)).toBe(499)

    // 4. The worker pays the developer their share and delivers the webhook.
    await tick(h.svc)
    const [app] = await h.db.select().from(apps).where(eq(apps.id, h.app.id))
    expect(fakeBalance(h.nessie, app.nessieAccountId!)).toBe(474)
    expect(fakeBalance(h.nessie, h.platformAccountId)).toBe(25) // Ferry keeps the fee
    const payouts = await h.call<{
      data: { status: string; amountCents: number }[]
    }>(listPayouts)
    expect(payouts.body.data).toMatchObject([
      { status: "paid", amountCents: 474 },
    ])

    expect(h.webhooks).toHaveLength(1)
    expect(h.webhooks[0].url).toBe("https://game.test/webhook")
    expect(h.webhooks[0].event).toMatchObject({
      type: "payment.succeeded",
      data: { payment: { id, status: "succeeded" } },
    })
    expect(h.verify(h.webhooks[0], app.webhookSecret!)).toBe(true)

    // 5. The game can also ask directly, if a webhook were ever lost.
    const byOrder = await h.call<{ id: string; status: string }>(getOrder, {
      params: { orderId: "order-1" },
    })
    expect(byOrder.body).toMatchObject({ id, status: "succeeded" })
    const viaApi = await h.call<{ status: string }>(getSession, {
      params: { id },
    })
    expect(viaApi.body.status).toBe("succeeded")
    const list = await h.call<{ data: unknown[] }>(listPayments, {
      path: "/?status=succeeded",
    })
    expect(list.body.data).toHaveLength(1)
  })

  it("is idempotent: the same order returns the same session, confirming twice charges once", async () => {
    const a = await h.call<{ id: string }>(createSession, { body: order() })
    const b = await h.call<{ id: string }>(createSession, { body: order() })
    expect(b.status).toBe(200)
    expect(b.body.id).toBe(a.body.id)

    const confirmOnce = () =>
      h.call<{ status: string }>(confirm, {
        key: null,
        params: { id: a.body.id },
        body: { paymentMethodId: paymentMethodId(h.playerAccountId) },
      })
    const results = await Promise.all([
      confirmOnce(),
      confirmOnce(),
      confirmOnce(),
    ])
    expect(
      results.some(
        (r) => r.body.status === "succeeded" || r.body.status === "processing"
      )
    ).toBe(true)
    await tick(h.svc)
    expect(h.nessie.withdrawals.get(h.playerAccountId)).toHaveLength(1)
    expect(fakeBalance(h.nessie, h.playerAccountId)).toBe(50_000 - 499)
  })

  it("rejects reusing an order id for a different player or product", async () => {
    await h.call(createSession, { body: order() })
    const res = await h.call<{ error: { code: string } }>(createSession, {
      body: order("order-1", "someone-else"),
    })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe("order_conflict")
  })
})

describe("authentication and validation", () => {
  it("needs a valid, unrevoked API key", async () => {
    expect(
      (await h.call(createSession, { body: order(), key: null })).status
    ).toBe(401)
    expect(
      (
        await h.call(createSession, {
          body: order(),
          key: "sk_test_not_a_real_key_000000",
        })
      ).status
    ).toBe(401)
    const [key] = await h.db.select().from(apiKeys)
    await revokeApiKey(h.db, h.app.id, key.id)
    expect((await h.call(createSession, { body: order() })).status).toBe(401)
  })

  it("only sells products of the calling app, at the stored price", async () => {
    const [other] = await h.db
      .insert(apps)
      .values({ ownerId: "user_other", name: "Other" })
      .returning()
    const [foreign] = await h.db
      .insert(products)
      .values({ appId: other.id, name: "Theirs", price: 100 })
      .returning()
    const res = await h.call<{ error: { code: string } }>(createSession, {
      body: { ...order(), productId: foreign.id },
    })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe("product_not_found")

    const tampered = await h.call<{ amountCents: number }>(createSession, {
      body: { ...order("o2"), amountCents: 1 },
    })
    expect(tampered.body.amountCents).toBe(499) // extra fields are ignored; price comes from the product
  })

  it("returns 400 with details for a bad body, 404 for unknown sessions", async () => {
    const bad = await h.call<{ error: { code: string } }>(createSession, {
      body: { orderId: "" },
    })
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe("invalid_request")
    expect(
      (await h.call(getCheckout, { key: null, params: { id: "nope" } })).status
    ).toBe(404)
  })

  it("guards the internal tick endpoint with INTERNAL_TOKEN", async () => {
    expect(
      (await h.call(tickRoute, { method: "POST", key: null })).status
    ).toBe(401)
    expect(
      (await h.call(tickRoute, { method: "POST", key: "test-internal-token" }))
        .status
    ).toBe(200)
  })
})
