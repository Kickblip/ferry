import { and, eq, isNull, lte, ne, or } from "drizzle-orm"
import { payments, payouts } from "@/lib/schema"
import { processPayout, reconcilePayment } from "@/lib/payments/payments"
import type { Services } from "@/lib/payments/services"
import { deliverDueWebhooks } from "@/lib/payments/webhooks"

/**
 * One pass of background work: expire stale sessions, retry processing
 * payments, pay out developers, and deliver webhooks. Runs on an interval via
 * instrumentation.ts, or call POST /api/internal/tick from a cron.
 */
export async function tick(svc: Services) {
  const now = svc.now()
  await svc.db
    .update(payments)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(payments.status, "requires_confirmation"),
        lte(payments.expiresAt, now)
      )
    )

  const due = <T extends typeof payments | typeof payouts>(table: T) =>
    or(isNull(table.nextAttemptAt), lte(table.nextAttemptAt, now))

  const processing = await svc.db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.status, "processing"), due(payments)))
    .limit(50)
  for (const { id } of processing) await reconcilePayment(svc, id)

  // Includes payouts the reconciles above just created.
  const unpaid = await svc.db
    .select({ id: payouts.id })
    .from(payouts)
    .where(and(ne(payouts.status, "paid"), due(payouts)))
    .limit(50)
  for (const { id } of unpaid) await processPayout(svc, id)

  await deliverDueWebhooks(svc)
}

export function startWorker(svc: Services) {
  const g = globalThis as unknown as { __paymentWorker?: NodeJS.Timeout }
  if (g.__paymentWorker) return
  let running = false
  g.__paymentWorker = setInterval(async () => {
    if (running) return
    running = true
    try {
      await tick(svc)
    } catch (err) {
      console.error("[payments worker]", err)
    } finally {
      running = false
    }
  }, svc.config.workerIntervalMs)
}
