import { and, desc, eq, lt } from "drizzle-orm"
import { payments, payouts, webhookDeliveries } from "@/lib/schema"
import { balanceCents } from "@/lib/payments/ledger"
import type { Services } from "@/lib/payments/services"

/**
 * Read helpers for the developer dashboard and the developer API. The
 * dashboard (server components, Clerk-authenticated) can call these directly
 * after checking the signed-in user owns the app.
 */
export interface ListOptions {
  limit?: number
  /** Return items created before this ISO timestamp (pagination). */
  before?: string
}

const page = (o: ListOptions) => Math.min(Math.max(o.limit ?? 25, 1), 100)

export async function listPayments(
  svc: Services,
  appId: string,
  o: ListOptions & { status?: string } = {}
) {
  return svc.db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.appId, appId),
        o.status ? eq(payments.status, o.status) : undefined,
        o.before ? lt(payments.createdAt, new Date(o.before)) : undefined
      )
    )
    .orderBy(desc(payments.createdAt))
    .limit(page(o))
}

export async function getPaymentForApp(
  svc: Services,
  appId: string,
  id: string
) {
  const [row] = await svc.db
    .select()
    .from(payments)
    .where(and(eq(payments.appId, appId), eq(payments.id, id)))
  return row
}

export async function getPaymentByOrder(
  svc: Services,
  appId: string,
  orderId: string
) {
  const [row] = await svc.db
    .select()
    .from(payments)
    .where(and(eq(payments.appId, appId), eq(payments.orderId, orderId)))
    .orderBy(desc(payments.createdAt))
    .limit(1)
  return row
}

export async function listPayouts(
  svc: Services,
  appId: string,
  o: ListOptions = {}
) {
  return svc.db
    .select()
    .from(payouts)
    .where(
      and(
        eq(payouts.appId, appId),
        o.before ? lt(payouts.createdAt, new Date(o.before)) : undefined
      )
    )
    .orderBy(desc(payouts.createdAt))
    .limit(page(o))
}

export async function listDeliveries(
  svc: Services,
  appId: string,
  o: ListOptions = {}
) {
  return svc.db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.appId, appId),
        o.before
          ? lt(webhookDeliveries.createdAt, new Date(o.before))
          : undefined
      )
    )
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(page(o))
}

/** The app's Nessie payout account balance, computed from Nessie's records. */
export async function appBalanceCents(
  svc: Services,
  nessieAccountId: string | null
) {
  if (!nessieAccountId) return 0
  return balanceCents(svc.nessie, nessieAccountId, svc.config.nessieAmountUnit)
}
