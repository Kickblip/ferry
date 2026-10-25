import { and, eq, notInArray } from "drizzle-orm"
import { z } from "zod"
import { apps, payments, products } from "@/lib/schema"
import type { App } from "@/lib/payments/api-keys"
import { ApiError } from "@/lib/payments/errors"
import { settleDeposit } from "@/lib/payments/ledger"
import { splitPayment } from "@/lib/payments/money"
import type { Services } from "@/lib/payments/services"
import type { Payment } from "@/lib/payments/views"

const FINAL_FAILURES = ["FAILED", "CANCELED", "EXPIRED"] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const createCheckoutInput = z.object({
  productId: z.string().regex(UUID, "productId must be a product id"),
  orderId: z.string().min(1).max(100),
  playerId: z.string().min(1).max(100),
  returnUrl: z.url().optional(),
  metadata: z.record(z.string(), z.string().max(500)).optional(),
})
export type CreateCheckoutInput = z.infer<typeof createCheckoutInput>

export function checkoutUrl(svc: Services, paymentId: string) {
  return `${svc.config.publicBaseUrl}/checkout/${paymentId}`
}

function notFound(id: string): never {
  throw new ApiError(404, "payment_not_found", `No checkout session ${id}`)
}

export async function createCheckout(
  svc: Services,
  app: App,
  input: CreateCheckoutInput
): Promise<{ payment: Payment; created: boolean }> {
  const findActive = async () => {
    const [row] = await svc.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.appId, app.id),
          eq(payments.orderId, input.orderId),
          notInArray(payments.status, [...FINAL_FAILURES])
        )
      )
    return row
  }
  const reuse = (payment: Payment) => {
    if (
      payment.productId !== input.productId ||
      payment.playerId !== input.playerId
    ) {
      throw new ApiError(
        409,
        "order_conflict",
        "This order belongs to a different product or player"
      )
    }
    return { payment, created: false }
  }
  const existing = await findActive()
  if (existing) {
    const current = await expireIfDue(svc, existing)
    if (current.status !== "EXPIRED") return reuse(current)
  }

  const [product] = await svc.db
    .select()
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.appId, app.id)))
  if (!product)
    throw new ApiError(404, "product_not_found", "No product in this app")
  if (!Number.isInteger(product.price) || product.price < 1) {
    throw new ApiError(
      400,
      "invalid_product_price",
      "This product has no valid price"
    )
  }
  if (!svc.config.platformAccountId) {
    throw new ApiError(
      503,
      "payments_not_configured",
      "Run payments:setup before accepting payments"
    )
  }

  const now = svc.now()
  try {
    const [payment] = await svc.db
      .insert(payments)
      .values({
        appId: app.id,
        productId: product.id,
        orderId: input.orderId,
        playerId: input.playerId,
        description: product.name,
        amountCents: product.price,
        ...splitPayment(product.price),
        status: "REQUIRES_CONFIRMATION",
        returnUrl: input.returnUrl,
        metadata: input.metadata,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 10 * 60_000),
      })
      .returning()
    return { payment, created: true }
  } catch (err) {
    // The unique index resolves simultaneous requests for the same order.
    const winner = await findActive()
    if (winner) return reuse(winner)
    throw err
  }
}

async function loadPayment(svc: Services, id: string): Promise<Payment> {
  if (!UUID.test(id)) notFound(id)
  const [row] = await svc.db.select().from(payments).where(eq(payments.id, id))
  return row ?? notFound(id)
}

async function expireIfDue(svc: Services, payment: Payment): Promise<Payment> {
  if (
    payment.status !== "REQUIRES_CONFIRMATION" ||
    payment.expiresAt > svc.now()
  ) {
    return payment
  }
  const [row] = await svc.db
    .update(payments)
    .set({ status: "EXPIRED", updatedAt: svc.now() })
    .where(
      and(
        eq(payments.id, payment.id),
        eq(payments.status, "REQUIRES_CONFIRMATION")
      )
    )
    .returning()
  return row ?? loadPayment(svc, payment.id)
}

export async function getPaymentApp(svc: Services, payment: Payment) {
  const [app] = await svc.db
    .select()
    .from(apps)
    .where(eq(apps.id, payment.appId))
  return app
}

/** Reads never confirm a payment or retry a Nessie deposit. */
export async function getCheckout(svc: Services, id: string): Promise<Payment> {
  return expireIfDue(svc, await loadPayment(svc, id))
}

/**
 * Demo payment always succeeds. Nessie settlement is a separate, retryable deposit.
 * shortcut: settlement runs in the request; add a worker if automatic recovery is needed.
 */
export async function confirmCheckout(
  svc: Services,
  id: string
): Promise<Payment> {
  await loadPayment(svc, id)
  if (!svc.config.platformAccountId) {
    throw new ApiError(
      503,
      "payments_not_configured",
      "Run payments:setup before accepting payments"
    )
  }
  const confirmed = await svc.db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, id))
      .for("update")
    if (
      payment.status === "SUCCEEDED" ||
      FINAL_FAILURES.some((status) => status === payment.status)
    )
      return payment
    const now = svc.now()
    const expired =
      payment.status === "REQUIRES_CONFIRMATION" && payment.expiresAt <= now
    const [updated] = await tx
      .update(payments)
      .set(
        expired
          ? { status: "EXPIRED", updatedAt: now }
          : {
              status: "SUCCEEDED",
              confirmedAt: payment.confirmedAt ?? now,
              succeededAt: now,
              updatedAt: now,
              failureCode: null,
              failureMessage: null,
            }
      )
      .where(eq(payments.id, id))
      .returning()
    return updated
  })
  if (confirmed.status === "EXPIRED") {
    throw new ApiError(
      410,
      "session_expired",
      "This checkout session has expired"
    )
  }
  if (confirmed.status !== "SUCCEEDED") {
    throw new ApiError(
      409,
      "checkout_not_payable",
      "This checkout can no longer be paid"
    )
  }

  // Commit the demo payment before contacting Nessie, so an outage cannot undo it.
  return svc.db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, id))
      .for("update")
    if (payment.settledAt) return payment
    let nessieDepositId: string
    try {
      nessieDepositId = await settleDeposit(
        svc.nessie,
        svc.config.platformAccountId,
        payment.id,
        payment.amountCents
      )
    } catch (error) {
      const [pending] = await tx
        .update(payments)
        .set({
          lastError:
            error instanceof Error ? error.message : "Nessie deposit failed",
          updatedAt: svc.now(),
        })
        .where(eq(payments.id, id))
        .returning()
      return pending
    }
    const [settled] = await tx
      .update(payments)
      .set({
        nessieDepositId,
        settledAt: svc.now(),
        lastError: null,
        updatedAt: svc.now(),
      })
      .where(eq(payments.id, id))
      .returning()
    return settled
  })
}

export async function cancelCheckout(
  svc: Services,
  id: string
): Promise<Payment> {
  const payment = await getCheckout(svc, id)
  if (payment.status === "PROCESSING" || payment.status === "SUCCEEDED") {
    throw new ApiError(
      409,
      "payment_in_progress",
      "This payment can no longer be canceled"
    )
  }
  const [row] = await svc.db
    .update(payments)
    .set({ status: "CANCELED", updatedAt: svc.now() })
    .where(
      and(eq(payments.id, id), eq(payments.status, "REQUIRES_CONFIRMATION"))
    )
    .returning()
  return row ?? loadPayment(svc, id)
}
