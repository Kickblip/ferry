import crypto from "node:crypto"
import { and, eq, notInArray } from "drizzle-orm"
import { z } from "zod"
import { apps, payerAccounts, payments, payouts, products } from "@/lib/schema"
import type { App } from "@/lib/payments/api-keys"
import { ApiError } from "@/lib/payments/errors"
import { advanceMovement, isComplete, newMovement } from "@/lib/payments/ledger"
import { splitPayment } from "@/lib/payments/money"
import type { Services, Tx } from "@/lib/payments/services"
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
  if (!app.nessieAccountId || !svc.config.platformAccountId) {
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

/** Reads never charge a player or retry a payout. */
export async function getCheckout(svc: Services, id: string): Promise<Payment> {
  return expireIfDue(svc, await loadPayment(svc, id))
}

export function paymentMethodId(nessieAccountId: string) {
  const digest = crypto
    .createHash("sha256")
    .update(`ferry-payment-method:${nessieAccountId}`)
    .digest("hex")
  return `pm_${digest.slice(0, 24)}`
}

export async function listPaymentMethods(svc: Services) {
  const accounts = await svc.db
    .select()
    .from(payerAccounts)
    .orderBy(payerAccounts.label)
  return accounts.map((a) => ({
    id: paymentMethodId(a.nessieAccountId),
    label: a.label,
  }))
}

/**
 * shortcut: bank calls run inside this request and DB transaction; use a durable
 * worker if unattended recovery or checkout latency becomes a requirement.
 * Repeating this POST resumes the saved charge or payout.
 */
export async function confirmCheckout(
  svc: Services,
  id: string,
  methodId: string
): Promise<Payment> {
  const initial = await getCheckout(svc, id)
  if (initial.status === "EXPIRED") {
    throw new ApiError(
      410,
      "session_expired",
      "This checkout session has expired"
    )
  }
  return svc.db.transaction(async (tx) => {
    let [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, id))
      .for("update")
    if (FINAL_FAILURES.some((status) => status === payment.status))
      return payment
    if (
      payment.payerAccountId &&
      paymentMethodId(payment.payerAccountId) !== methodId
    ) {
      throw new ApiError(
        409,
        "payment_method_conflict",
        "Retry with the original payment method"
      )
    }
    const [app] = await tx.select().from(apps).where(eq(apps.id, payment.appId))

    if (payment.status !== "SUCCEEDED") {
      if (!app.nessieAccountId || !svc.config.platformAccountId) {
        throw new ApiError(
          503,
          "payments_not_configured",
          "Run payments:setup before accepting payments"
        )
      }
      const accounts = await tx.select().from(payerAccounts)
      const payer = accounts.find(
        (account) => paymentMethodId(account.nessieAccountId) === methodId
      )
      if (!payer)
        throw new ApiError(
          400,
          "unknown_payment_method",
          "Choose one of the listed payment methods"
        )
      // Different orders using one demo account must check its funds in order.
      await tx
        .select()
        .from(payerAccounts)
        .where(eq(payerAccounts.nessieAccountId, payer.nessieAccountId))
        .for("update")

      const charge =
        payment.charge ??
        newMovement(
          payment.id,
          payer.nessieAccountId,
          svc.config.platformAccountId,
          payment.amountCents
        )
      let failureCode: Payment["failureCode"] = null
      let failureMessage: string | null = null
      let lastError: string | null = null
      try {
        await advanceMovement(svc.nessie, charge, {
          note: `payment ${payment.orderId}`,
          checkFunds: true,
        })
      } catch (err) {
        lastError = (err as Error).message
        // Only explicit pre-withdrawal declines are final; partial moves remain resumable.
        if (
          err instanceof ApiError &&
          (err.code === "INSUFFICIENT_FUNDS" || err.code === "NESSIE_REJECTED")
        ) {
          failureCode = err.code
          failureMessage = err.message
        }
      }
      const status = failureCode
        ? "FAILED"
        : isComplete(charge)
          ? "SUCCEEDED"
          : "PROCESSING"
      ;[payment] = await tx
        .update(payments)
        .set({
          status,
          charge,
          payerAccountId: payer.nessieAccountId,
          confirmedAt: payment.confirmedAt ?? svc.now(),
          succeededAt: status === "SUCCEEDED" ? svc.now() : null,
          failureCode,
          failureMessage,
          lastError,
          updatedAt: svc.now(),
        })
        .where(eq(payments.id, id))
        .returning()
    }

    if (payment.status === "SUCCEEDED")
      await payDeveloper(svc, tx, payment, app)
    return payment
  })
}

async function payDeveloper(svc: Services, tx: Tx, payment: Payment, app: App) {
  let [payout] = await tx
    .select()
    .from(payouts)
    .where(eq(payouts.paymentId, payment.id))
  if (!payout) {
    // A stable ref also survives a DB rollback after Nessie accepted the payout.
    ;[payout] = await tx
      .insert(payouts)
      .values({
        id: payment.id,
        paymentId: payment.id,
        appId: payment.appId,
        amountCents: payment.netCents,
        transfer: newMovement(
          `payout:${payment.id}`,
          svc.config.platformAccountId,
          app.nessieAccountId!,
          payment.netCents
        ),
        createdAt: svc.now(),
        updatedAt: svc.now(),
      })
      .returning()
  }
  if (payout.status === "PAID") return
  let lastError: string | null = null
  try {
    await advanceMovement(svc.nessie, payout.transfer, {
      note: `payout ${payment.id}`,
    })
  } catch (err) {
    lastError = (err as Error).message
  }
  const paid = isComplete(payout.transfer)
  await tx
    .update(payouts)
    .set({
      transfer: payout.transfer,
      status: paid ? "PAID" : "PENDING",
      lastError,
      paidAt: paid ? svc.now() : null,
      updatedAt: svc.now(),
    })
    .where(eq(payouts.id, payout.id))
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
