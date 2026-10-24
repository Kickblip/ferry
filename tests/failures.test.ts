import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { POST as createSession } from "@/app/api/v1/checkout/sessions/route"
import { GET as getCheckout } from "@/app/api/checkout/[id]/route"
import { POST as confirm } from "@/app/api/checkout/[id]/confirm/route"
import { POST as cancel } from "@/app/api/checkout/[id]/cancel/route"
import { GET as listDeliveries } from "@/app/api/v1/webhook-deliveries/route"
import { POST as retryDelivery } from "@/app/api/v1/webhook-deliveries/[id]/retry/route"
import { apps, payouts } from "@/lib/schema"
import { paymentMethodId } from "@/lib/payments/payments"
import { WEBHOOK_MAX_ATTEMPTS } from "@/lib/payments/retry"
import { tick } from "@/lib/payments/worker"
import { createHarness, fakeBalance, type Harness } from "./harness"

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.close()
})

async function startCheckout(orderId = "order-1") {
  const res = await h.call<{ id: string }>(createSession, {
    body: { productId: h.product.id, orderId, playerId: "p1" },
  })
  return res.body.id
}
const pay = (id: string, account = h.playerAccountId) =>
  h.call<{ status: string; failureCode: string | null }>(confirm, {
    key: null,
    params: { id },
    body: { paymentMethodId: paymentMethodId(account) },
  })
const view = (id: string) =>
  h.call<{ status: string; failureCode: string | null }>(getCheckout, {
    key: null,
    params: { id },
  })

/** Advances the clock past any retry backoff (max 1 hour) and runs the worker. */
async function later(times = 1) {
  for (let i = 0; i < times; i++) {
    h.advance(2 * 60 * 60_000)
    await tick(h.svc)
  }
}

describe("payment failures", () => {
  it("fails cleanly on insufficient funds without touching the money", async () => {
    const id = await startCheckout()
    const res = await pay(id, h.poorPlayerAccountId)
    expect(res.body).toMatchObject({
      status: "failed",
      failureCode: "insufficient_funds",
    })
    expect(h.nessie.withdrawals.get(h.poorPlayerAccountId) ?? []).toHaveLength(
      0
    )
    await tick(h.svc)
    expect(h.webhooks.map((w) => w.event.type)).toEqual(["payment.failed"])
  })

  it("fails without charging when Nessie rejects the withdrawal", async () => {
    const id = await startCheckout()
    h.nessie.failNext("createWithdrawal", "reject")
    expect((await pay(id)).body).toMatchObject({
      status: "failed",
      failureCode: "nessie_rejected",
    })
    expect(fakeBalance(h.nessie, h.playerAccountId)).toBe(50_000)
  })

  it("lets the player retry the same order after a failed attempt", async () => {
    const first = await startCheckout()
    await pay(first, h.poorPlayerAccountId)
    const second = await startCheckout()
    expect(second).not.toBe(first)
    expect((await pay(second)).body.status).toBe("succeeded")
  })

  it("keeps processing through a Nessie outage, then succeeds", async () => {
    const id = await startCheckout()
    h.nessie.failNext("listWithdrawals", "error", 2)
    expect((await pay(id)).body.status).toBe("processing")
    await later(2)
    expect((await view(id)).body.status).toBe("succeeded")
    expect(h.nessie.withdrawals.get(h.playerAccountId)).toHaveLength(1)
  })

  it("gives up after repeated outages only if no money moved", async () => {
    const id = await startCheckout()
    // MAX_CHARGE_ATTEMPTS (5) consecutive outages: the confirm plus 4 retries.
    h.nessie.failNext("listWithdrawals", "error", 5)
    await pay(id)
    await later(4)
    const res = await view(id)
    expect(res.body).toMatchObject({
      status: "failed",
      failureCode: "nessie_unavailable",
    })
    expect(fakeBalance(h.nessie, h.playerAccountId)).toBe(50_000)
  })
})

describe("no double charges after timeouts", () => {
  it("withdrawal written but the response timed out: retry finds it instead of charging again", async () => {
    const id = await startCheckout()
    h.nessie.failNext("createWithdrawal", "timeout-after-write")
    expect((await pay(id)).body.status).toBe("processing")
    await later()
    expect((await view(id)).body.status).toBe("succeeded")
    expect(h.nessie.withdrawals.get(h.playerAccountId)).toHaveLength(1)
    expect(h.nessie.deposits.get(h.platformAccountId)).toHaveLength(1)
    expect(fakeBalance(h.nessie, h.playerAccountId)).toBe(50_000 - 499)
  })

  it("deposit written but timed out: the platform is credited exactly once", async () => {
    const id = await startCheckout()
    h.nessie.failNext("createDeposit", "timeout-after-write")
    await pay(id)
    await later()
    expect((await view(id)).body.status).toBe("succeeded")
    expect(h.nessie.deposits.get(h.platformAccountId)).toHaveLength(1)
  })

  it("once the player's money has left, never marks the payment failed", async () => {
    const id = await startCheckout()
    h.nessie.failNext("createWithdrawal", "timeout-after-write")
    h.nessie.failNext("createDeposit", "error", 6)
    await pay(id)
    await later(6)
    expect((await view(id)).body.status).not.toBe("failed")
    await later()
    expect((await view(id)).body.status).toBe("succeeded")
  })
})

describe("developer payouts", () => {
  it("retries a failed payout without re-charging the player", async () => {
    const id = await startCheckout()
    expect((await pay(id)).body.status).toBe("succeeded")
    const [app] = await h.db.select().from(apps).where(eq(apps.id, h.app.id))
    h.nessie.failNext("createDeposit", "error", 2)
    await tick(h.svc)
    let [payout] = await h.db.select().from(payouts)
    expect(payout.status).toBe("processing")
    await later(2)
    ;[payout] = await h.db.select().from(payouts)
    expect(payout.status).toBe("paid")
    expect(fakeBalance(h.nessie, app.nessieAccountId!)).toBe(474)
    expect(h.nessie.withdrawals.get(h.playerAccountId)).toHaveLength(1)
    expect(h.nessie.withdrawals.get(h.platformAccountId)).toHaveLength(1)
  })
})

describe("webhook delivery", () => {
  it("retries a failing endpoint with backoff until it succeeds", async () => {
    await pay(await startCheckout())
    h.setWebhookStatus(500)
    await tick(h.svc)
    let deliveries = await h.call<{
      data: { status: string; attempts: number; responseStatus: number }[]
    }>(listDeliveries)
    expect(deliveries.body.data[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      responseStatus: 500,
    })

    await tick(h.svc) // not due yet: no new attempt
    expect(h.webhooks).toHaveLength(1)

    h.setWebhookStatus(200)
    await later()
    deliveries = await h.call(listDeliveries)
    expect(deliveries.body.data[0]).toMatchObject({
      status: "delivered",
      attempts: 2,
    })
  })

  it("marks a delivery failed after the last attempt, and can re-queue it", async () => {
    await pay(await startCheckout())
    h.setWebhookStatus(500)
    await later(WEBHOOK_MAX_ATTEMPTS + 1)
    const deliveries = await h.call<{
      data: { id: string; status: string; attempts: number }[]
    }>(listDeliveries)
    expect(deliveries.body.data[0]).toMatchObject({
      status: "failed",
      attempts: WEBHOOK_MAX_ATTEMPTS,
    })

    h.setWebhookStatus(200)
    const retried = await h.call<{ status: string }>(retryDelivery, {
      method: "POST",
      params: { id: deliveries.body.data[0].id },
    })
    expect(retried.body.status).toBe("pending")
    await tick(h.svc)
    const after = await h.call<{ data: { status: string }[] }>(listDeliveries)
    expect(after.body.data[0].status).toBe("delivered")
  })
})

describe("session lifecycle", () => {
  it("expires unconfirmed sessions and refuses to pay them", async () => {
    const id = await startCheckout()
    h.advance(31 * 60_000)
    expect((await view(id)).body.status).toBe("expired")
    expect((await pay(id)).status).toBe(410)
  })

  it("lets the player cancel before paying, but not after", async () => {
    const id = await startCheckout()
    const res = await h.call<{ status: string }>(cancel, {
      method: "POST",
      key: null,
      params: { id },
    })
    expect(res.body.status).toBe("canceled")
    expect((await pay(id)).body.status).toBe("canceled")

    const paid = await startCheckout("order-2")
    await pay(paid)
    expect(
      (
        await h.call(cancel, {
          method: "POST",
          key: null,
          params: { id: paid },
        })
      ).status
    ).toBe(409)
  })

  it("only accepts the listed payment methods", async () => {
    const id = await startCheckout()
    const res = await h.call<{ error: { code: string } }>(confirm, {
      key: null,
      params: { id },
      body: { paymentMethodId: "pm_someone_elses" },
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe("unknown_payment_method")
  })
})
