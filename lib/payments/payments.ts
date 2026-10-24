import crypto from "node:crypto"
import { and, eq, isNull, lte, notInArray, or } from "drizzle-orm"
import { z } from "zod"
import { apps, payerAccounts, payments, payouts, products } from "@/lib/schema"
import type { App } from "@/lib/payments/api-keys"
import { ensurePaymentSetup } from "@/lib/payments/apps"
import { ApiError, NessieError } from "@/lib/payments/errors"
import { advanceMovement, isComplete, newMovement } from "@/lib/payments/ledger"
import { splitPayment } from "@/lib/payments/money"
import { nextAttemptAt } from "@/lib/payments/retry"
import type { Services } from "@/lib/payments/services"
import type { Movement } from "@/lib/payments/types"
import type { Payment, Payout } from "@/lib/payments/views"
import { enqueueWebhook } from "@/lib/payments/webhooks"

/** Give up on a charge that never started after this many failed attempts. */
const MAX_CHARGE_ATTEMPTS = 5
/** How long a worker owns a payment/payout while it talks to Nessie. */
const LEASE_MS = 30_000
const FINAL_FAILURES = ["failed", "canceled", "expired"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const createCheckoutInput = z.object({
  /** A product of this app; its price is the amount charged. */
  productId: z.string().regex(UUID, "productId must be a product id"),
  orderId: z.string().min(1).max(100),
  playerId: z.string().min(1).max(100),
  returnUrl: z.url().optional(),
  metadata: z.record(z.string(), z.string().max(500)).optional(),
})
export type CreateCheckoutInput = z.infer<typeof createCheckoutInput>

export function checkoutUrl(svc: Services, paymentId: string) {
  return `${svc.config.publicBaseUrl}${svc.config.checkoutPath}/${paymentId}`
}

function notFound(id: string): never {
  throw new ApiError(404, "payment_not_found", `No checkout session ${id}`)
}

/**
 * Creates a checkout session for one of the app's products. The price comes
 * from the database, never from the request. Idempotent per app + orderId:
 * repeating the call returns the existing session (`created: false`) unless
 * that attempt failed, was canceled or expired, in which case a new attempt is
 * made. Reusing an orderId for a different product or player is a 409.
 */
export async function createCheckout(
  svc: Services,
  app: App,
  input: CreateCheckoutInput
): Promise<{ payment: Payment; created: boolean }> {
  const [product] = await svc.db
    .select()
    .from(products)
    .where(and(eq(products.id, input.productId), eq(products.appId, app.id)))
  if (!product) {
    throw new ApiError(
      404,
      "product_not_found",
      `No product ${input.productId} in this app`
    )
  }
  if (!Number.isInteger(product.price) || product.price < 1) {
    throw new ApiError(
      400,
      "invalid_product_price",
      "This product has no valid price"
    )
  }
  const ready = await ensurePaymentSetup(svc, app)

  const findActive = async () => {
    const [row] = await svc.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.appId, app.id),
          eq(payments.orderId, input.orderId),
          notInArray(payments.status, FINAL_FAILURES)
        )
      )
    return row
  }
  const reuse = (existing: Payment) => {
    if (
      existing.productId !== input.productId ||
      existing.playerId !== input.playerId
    ) {
      throw new ApiError(
        409,
        "order_conflict",
        `Order ${input.orderId} already exists for a different product or player`
      )
    }
    return { payment: existing, created: false }
  }

  const existing = await findActive()
  if (existing) return reuse(existing)

  const now = svc.now()
  const { feeCents, netCents } = splitPayment(
    product.price,
    ready.feeBps ?? svc.config.platformFeeBps
  )
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
        currency: "usd",
        feeCents,
        netCents,
        status: "requires_confirmation",
        returnUrl: input.returnUrl,
        metadata: input.metadata,
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(
          now.getTime() + svc.config.sessionTtlMinutes * 60_000
        ),
      })
      .returning()
    return { payment, created: true }
  } catch (err) {
    // Two requests raced on the same order: the unique index let one through.
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

/** Expires an unconfirmed session whose time is up. */
async function expireIfDue(svc: Services, payment: Payment): Promise<Payment> {
  const now = svc.now()
  if (payment.status !== "requires_confirmation" || payment.expiresAt > now) {
    return payment
  }
  const [row] = await svc.db
    .update(payments)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(payments.id, payment.id),
        eq(payments.status, "requires_confirmation")
      )
    )
    .returning()
  return row ?? (await loadPayment(svc, payment.id))
}

export async function getPaymentApp(svc: Services, payment: Payment) {
  const [app] = await svc.db
    .select()
    .from(apps)
    .where(eq(apps.id, payment.appId))
  return app
}

/** Loads a session for the checkout page, nudging a processing payment forward. */
export async function getCheckout(svc: Services, id: string): Promise<Payment> {
  const payment = await expireIfDue(svc, await loadPayment(svc, id))
  if (payment.status === "processing") return reconcilePayment(svc, id)
  return payment
}

/**
 * The opaque id the checkout page uses for a demo account, like a card
 * processor's saved payment method. The page never sees the Nessie account id
 * or its balance; only the server maps the token back to the account.
 */
export function paymentMethodId(nessieAccountId: string) {
  const digest = crypto
    .createHash("sha256")
    .update(`ferry-payment-method:${nessieAccountId}`)
    .digest("hex")
  return `pm_${digest.slice(0, 24)}`
}

/** Saved payment methods the player can pick: a label and an opaque id only. */
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

async function resolvePaymentMethod(svc: Services, methodId: string) {
  const accounts = await svc.db.select().from(payerAccounts)
  return accounts.find((a) => paymentMethodId(a.nessieAccountId) === methodId)
}

/**
 * The player confirms on the checkout page with one of their saved payment
 * methods (demo Nessie accounts). Moves the session to "processing" and
 * immediately tries to move the money; whatever doesn't finish now is retried
 * by the worker. Confirming again (double-click, network retry) returns the
 * current state and never charges twice. Funds are checked server-side only:
 * a shortfall comes back as a decline, never as a balance.
 */
export async function confirmCheckout(
  svc: Services,
  id: string,
  methodId: string
): Promise<Payment> {
  const payment = await expireIfDue(svc, await loadPayment(svc, id))
  if (payment.status === "expired") {
    throw new ApiError(
      410,
      "session_expired",
      "This checkout session has expired"
    )
  }
  if (payment.status !== "requires_confirmation") return payment

  const payer = await resolvePaymentMethod(svc, methodId)
  if (!payer) {
    throw new ApiError(
      400,
      "unknown_payment_method",
      "Choose one of the listed payment methods"
    )
  }
  const payerAccountId = payer.nessieAccountId
  if (!svc.config.platformAccountId) {
    throw new ApiError(
      503,
      "payments_not_configured",
      "PLATFORM_ACCOUNT_ID is not set"
    )
  }

  const now = svc.now()
  const [confirmed] = await svc.db
    .update(payments)
    .set({
      status: "processing",
      payerAccountId,
      charge: newMovement(
        id,
        payerAccountId,
        svc.config.platformAccountId,
        payment.amountCents
      ),
      confirmedAt: now,
      updatedAt: now,
      nextAttemptAt: null,
    })
    .where(
      and(eq(payments.id, id), eq(payments.status, "requires_confirmation"))
    )
    .returning()
  // Lost a race with another confirm: report whatever state won.
  if (!confirmed) return loadPayment(svc, id)
  return reconcilePayment(svc, id)
}

export async function cancelCheckout(
  svc: Services,
  id: string
): Promise<Payment> {
  const payment = await loadPayment(svc, id)
  if (payment.status === "processing" || payment.status === "succeeded") {
    throw new ApiError(
      409,
      "payment_in_progress",
      "This payment can no longer be canceled"
    )
  }
  const [row] = await svc.db
    .update(payments)
    .set({ status: "canceled", updatedAt: svc.now() })
    .where(
      and(eq(payments.id, id), eq(payments.status, "requires_confirmation"))
    )
    .returning()
  return row ?? loadPayment(svc, id)
}

/**
 * Claims a processing payment for LEASE_MS so only one worker (across all
 * server instances) talks to Nessie about it at a time. Returns null if it's
 * not due or someone else holds it.
 */
async function claimPayment(
  svc: Services,
  id: string
): Promise<Payment | null> {
  const now = svc.now()
  const [row] = await svc.db
    .update(payments)
    .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
    .where(
      and(
        eq(payments.id, id),
        eq(payments.status, "processing"),
        or(isNull(payments.nextAttemptAt), lte(payments.nextAttemptAt, now))
      )
    )
    .returning()
  return row ?? null
}

/**
 * Before giving up on a charge, make sure no withdrawal for it reached Nessie
 * (a timeout can hide a successful write). If Nessie can't be asked, assume it
 * might have and keep retrying.
 */
async function withdrawalMayExist(svc: Services, charge: Movement) {
  try {
    const withdrawals = await svc.nessie.listWithdrawals(charge.fromAccountId)
    return withdrawals.some((t) => t.description?.split(" ")[0] === charge.ref)
  } catch {
    return true
  }
}

/**
 * Pushes a processing payment toward success: player → platform via Nessie.
 * On success it records the payment, queues the developer payout and the
 * payment.succeeded webhook in one transaction.
 */
export async function reconcilePayment(
  svc: Services,
  id: string
): Promise<Payment> {
  const payment = await claimPayment(svc, id)
  if (!payment?.charge) return loadPayment(svc, id)

  let charge = payment.charge
  // `message` is what developers and the player see; `detail` (raw Nessie
  // errors, which name internal accounts) stays in lastError for debugging.
  let failure: { code: string; message: string; detail?: string } | undefined
  let retryError: string | undefined
  try {
    charge = await advanceMovement(
      svc.nessie,
      charge,
      svc.config.nessieAmountUnit,
      {
        note: `payment ${payment.orderId}`,
        checkFunds: true,
      }
    )
  } catch (err) {
    const started =
      payment.charge.withdrawal.status === "completed" ||
      !!payment.charge.withdrawal.nessieId
    if (err instanceof ApiError) {
      // insufficient_funds / amount_not_whole_dollars: raised before money moved.
      failure = { code: err.code, message: err.message }
    } else if (err instanceof NessieError && !err.retryable && !started) {
      failure = {
        code: "nessie_rejected",
        message: "The payment was declined by the bank",
        detail: err.message,
      }
    } else if (
      !started &&
      payment.attempts + 1 >= MAX_CHARGE_ATTEMPTS &&
      !(await withdrawalMayExist(svc, payment.charge))
    ) {
      failure = {
        code: "nessie_unavailable",
        message: "The bank is unavailable right now. Please try again later",
        detail: (err as Error).message,
      }
    } else {
      // Retryable, or the player's money already left: keep going until the
      // platform has it.
      retryError = (err as Error).message
    }
  }

  const now = svc.now()
  return svc.db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, id))
      .for("update")
    if (current.status !== "processing") return current
    const [app] = await tx.select().from(apps).where(eq(apps.id, current.appId))

    if (failure) {
      const [failed] = await tx
        .update(payments)
        .set({
          status: "failed",
          charge,
          failureCode: failure.code,
          failureMessage: failure.message,
          lastError: failure.detail ?? null,
          nextAttemptAt: null,
          updatedAt: now,
        })
        .where(eq(payments.id, id))
        .returning()
      await enqueueWebhook(tx, app, "payment.failed", failed, now)
      return failed
    }

    if (retryError || !isComplete(charge)) {
      const attempts = current.attempts + 1
      const [waiting] = await tx
        .update(payments)
        .set({
          charge,
          attempts,
          lastError:
            retryError ?? "Waiting for Nessie to complete the transaction",
          nextAttemptAt: new Date(nextAttemptAt(attempts, now)),
          updatedAt: now,
        })
        .where(eq(payments.id, id))
        .returning()
      return waiting
    }

    const [succeeded] = await tx
      .update(payments)
      .set({
        status: "succeeded",
        charge,
        succeededAt: now,
        lastError: null,
        nextAttemptAt: null,
        updatedAt: now,
      })
      .where(eq(payments.id, id))
      .returning()
    const payoutId = crypto.randomUUID()
    await tx.insert(payouts).values({
      id: payoutId,
      paymentId: id,
      appId: current.appId,
      amountCents: current.netCents,
      status: "pending",
      transfer: newMovement(
        payoutId,
        svc.config.platformAccountId,
        app.nessieAccountId!,
        current.netCents
      ),
      createdAt: now,
      updatedAt: now,
    })
    await enqueueWebhook(tx, app, "payment.succeeded", succeeded, now)
    return succeeded
  })
}

async function claimPayout(svc: Services, id: string): Promise<Payout | null> {
  const now = svc.now()
  const [row] = await svc.db
    .update(payouts)
    .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
    .where(
      and(
        eq(payouts.id, id),
        notInArray(payouts.status, ["paid"]),
        or(isNull(payouts.nextAttemptAt), lte(payouts.nextAttemptAt, now))
      )
    )
    .returning()
  return row ?? null
}

/**
 * Pays a developer their share (platform → developer). Independent of the
 * player's checkout: the player never waits on it, and a failure is retried
 * with backoff without ever re-charging the player.
 */
export async function processPayout(svc: Services, id: string) {
  const payout = await claimPayout(svc, id)
  if (!payout) return null

  let transfer = payout.transfer
  let error: string | undefined
  try {
    transfer = await advanceMovement(
      svc.nessie,
      transfer,
      svc.config.nessieAmountUnit,
      {
        note: `payout ${payout.paymentId}`,
      }
    )
  } catch (err) {
    error = (err as Error).message
  }

  const now = svc.now()
  const done = !error && isComplete(transfer)
  const attempts = done ? payout.attempts : payout.attempts + 1
  const [row] = await svc.db
    .update(payouts)
    .set({
      transfer,
      status: done ? "paid" : "processing",
      paidAt: done ? now : null,
      attempts,
      lastError: done
        ? null
        : (error ?? "Waiting for Nessie to complete the transaction"),
      nextAttemptAt: done ? null : new Date(nextAttemptAt(attempts, now)),
      updatedAt: now,
    })
    .where(eq(payouts.id, id))
    .returning()
  return row
}
