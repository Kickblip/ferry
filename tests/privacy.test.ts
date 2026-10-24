import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { POST as createSession } from "@/app/api/v1/checkout/sessions/route"
import { GET as getSession } from "@/app/api/v1/checkout/sessions/[id]/route"
import { GET as listPayments } from "@/app/api/v1/payments/route"
import { GET as listPayouts } from "@/app/api/v1/payouts/route"
import { GET as getCheckout } from "@/app/api/checkout/[id]/route"
import { GET as getPaymentMethods } from "@/app/api/checkout/[id]/payment-methods/route"
import { POST as confirm } from "@/app/api/checkout/[id]/confirm/route"
import { paymentMethodId } from "@/lib/payments/payments"
import { tick } from "@/lib/payments/worker"
import { createHarness, type Harness } from "./harness"

let h: Harness
beforeEach(async () => {
  h = await createHarness()
})
afterEach(async () => {
  await h.close()
})

/**
 * Like a real card processor: developers and the checkout page learn whether a
 * payment succeeded, never anything about the player's bank account.
 */
describe("player bank details stay private", () => {
  it("never exposes player account ids, balances or bank transaction ids", async () => {
    const seen: string[] = []
    const record = <T>(r: { body: T }) => {
      seen.push(JSON.stringify(r.body))
      return r
    }

    const start = async (orderId: string) =>
      record(
        await h.call<{ id: string }>(createSession, {
          body: { productId: h.product.id, orderId, playerId: "p1" },
        })
      ).body.id

    // A successful purchase and a declined one.
    const ok = await start("order-ok")
    record(await h.call(getPaymentMethods, { key: null, params: { id: ok } }))
    record(
      await h.call(confirm, {
        key: null,
        params: { id: ok },
        body: { paymentMethodId: paymentMethodId(h.playerAccountId) },
      })
    )
    const declined = await start("order-declined")
    const decline = record(
      await h.call<{
        status: string
        failureCode: string
        failureMessage: string
      }>(confirm, {
        key: null,
        params: { id: declined },
        body: { paymentMethodId: paymentMethodId(h.poorPlayerAccountId) },
      })
    )
    await tick(h.svc)

    // Everything a developer or the checkout page can read.
    record(await h.call(getCheckout, { key: null, params: { id: ok } }))
    record(await h.call(getSession, { params: { id: ok } }))
    record(await h.call(listPayments))
    record(await h.call(listPayouts))
    for (const w of h.webhooks) seen.push(w.body)
    const everything = seen.join("\n")

    const playerTxnIds = [h.playerAccountId, h.poorPlayerAccountId].flatMap(
      (account) => (h.nessie.withdrawals.get(account) ?? []).map((t) => t._id)
    )
    expect(playerTxnIds.length).toBeGreaterThan(0) // the check below has real ids to look for
    for (const secret of [
      h.playerAccountId,
      h.poorPlayerAccountId,
      h.platformAccountId,
      ...playerTxnIds,
    ]) {
      expect(everything).not.toContain(secret)
    }
    expect(everything).not.toMatch(/balance/i)

    // A shortfall reads like a card decline: a code, never an amount.
    expect(decline.body).toMatchObject({
      status: "failed",
      failureCode: "insufficient_funds",
      failureMessage: "The payment was declined",
    })
  })
})
