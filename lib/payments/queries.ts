import { and, count, desc, eq, sql } from "drizzle-orm"
import { payments, products } from "@/lib/schema"
import type { Db, Services } from "@/lib/payments/services"

export async function getAppDashboard(db: Db, appId: string, now = new Date()) {
  const successful = and(
    eq(payments.appId, appId),
    eq(payments.status, "SUCCEEDED")
  )
  const paidAt = sql`coalesce(${payments.succeededAt}, ${payments.createdAt})`
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const [transactions, [stats]] = await Promise.all([
    db
      .select({
        id: payments.id,
        productName: payments.description,
        imageUrl: products.imageUrl,
        revenueCents: payments.netCents,
        date: paidAt.mapWith(payments.createdAt),
      })
      .from(payments)
      .leftJoin(
        products,
        and(eq(products.id, payments.productId), eq(products.appId, appId))
      )
      .where(successful)
      .orderBy(desc(paidAt), desc(payments.id))
      .limit(20),
    db
      .select({
        revenueCents: sql`coalesce(sum(${payments.netCents}), 0)`.mapWith(
          Number
        ),
        recentRevenueCents:
          sql`coalesce(sum(${payments.netCents}) filter (where ${paidAt} >= ${since.toISOString()}::timestamptz), 0)`.mapWith(
            Number
          ),
        sales: count(),
        averageRevenueCents:
          sql`coalesce(avg(${payments.netCents}), 0)`.mapWith(Number),
      })
      .from(payments)
      .where(successful),
  ])
  return { transactions, stats }
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
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(1)
  return row
}
