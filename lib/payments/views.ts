import type { App } from "@/lib/payments/api-keys"
import type { payments } from "@/lib/schema"

export type Payment = typeof payments.$inferSelect

const iso = (d: Date | null) => (d ? d.toISOString() : null)

/**
 * How a payment appears to developers. Like a
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

const FINAL = new Set(["SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"])

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
