import { and, desc, eq } from "drizzle-orm"
import { payments } from "@/lib/schema"
import type { Services } from "@/lib/payments/services"

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
