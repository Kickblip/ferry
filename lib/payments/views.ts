import type { App } from "@/lib/payments/api-keys"
import type { payments, payouts, webhookDeliveries } from "@/lib/schema"

export type Payment = typeof payments.$inferSelect
export type Payout = typeof payouts.$inferSelect
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect

const iso = (d: Date | null) => (d ? d.toISOString() : null)

/**
 * How a payment appears to developers (API responses and webhooks). Like a
 * card processor, it never includes anything about the player's bank account:
 * no account ids, balances, or bank transaction ids.
 */
export function publicPayment(p: Payment) {
  return {
    id: p.id,
    orderId: p.orderId,
    productId: p.productId,
    playerId: p.playerId,
    description: p.description,
    amountCents: p.amountCents,
    feeCents: p.feeCents,
    netCents: p.netCents,
    currency: p.currency,
    status: p.status,
    failureCode: p.failureCode,
    failureMessage: p.failureMessage,
    metadata: p.metadata ?? {},
    createdAt: iso(p.createdAt),
    confirmedAt: iso(p.confirmedAt),
    succeededAt: iso(p.succeededAt),
    expiresAt: iso(p.expiresAt),
  }
}

const FINAL = new Set(["succeeded", "failed", "canceled", "expired"])

/** What the player-facing checkout page may see: no secrets, no other players. */
export function checkoutView(
  p: Payment,
  app: Pick<App, "name"> | undefined,
  checkoutUrl: string
) {
  let returnUrl: string | null = null
  if (FINAL.has(p.status) && p.returnUrl) {
    const url = new URL(p.returnUrl)
    url.searchParams.set("payment_id", p.id)
    url.searchParams.set("status", p.status)
    returnUrl = url.toString()
  }
  return {
    id: p.id,
    status: p.status,
    amountCents: p.amountCents,
    currency: p.currency,
    description: p.description,
    merchant: { name: app?.name ?? "Unknown merchant" },
    expiresAt: iso(p.expiresAt),
    failureCode: p.failureCode,
    failureMessage: p.failureMessage,
    checkoutUrl,
    /** Where to send the player once the payment is final (null until then). */
    returnUrl,
  }
}

/**
 * A payout as the developer sees it. Includes the deposit into *their own*
 * Nessie account (their bank reference), nothing about Ferry's or players'.
 */
export function publicPayout(p: Payout) {
  return {
    id: p.id,
    paymentId: p.paymentId,
    amountCents: p.amountCents,
    status: p.status,
    attempts: p.attempts,
    createdAt: iso(p.createdAt),
    paidAt: iso(p.paidAt),
    depositId: p.transfer.deposit.nessieId ?? null,
  }
}

export function publicDelivery(d: WebhookDelivery) {
  return {
    id: d.id,
    eventId: d.eventId,
    type: d.type,
    paymentId: d.paymentId,
    status: d.status,
    attempts: d.attempts,
    responseStatus: d.responseStatus,
    lastError: d.lastError,
    nextAttemptAt: iso(d.nextAttemptAt),
    createdAt: iso(d.createdAt),
    deliveredAt: iso(d.deliveredAt),
  }
}

export function publicPaymentSettings(app: App) {
  return {
    appId: app.id,
    name: app.name,
    nessieAccountId: app.nessieAccountId,
    webhookUrl: app.webhookUrl,
    hasWebhookSecret: !!app.webhookSecret,
    feeBps: app.feeBps,
  }
}
