import { and, eq, ne, sum } from "drizzle-orm"
import { payouts } from "@/lib/schema"
import { appRoute, json } from "@/lib/payments/http"
import { appBalanceCents } from "@/lib/payments/queries"

/** Paid-out balance in the app's Nessie account, plus payouts still on the way. */
export const GET = appRoute(async (_request, svc, app) => {
  const [pending] = await svc.db
    .select({ cents: sum(payouts.amountCents) })
    .from(payouts)
    .where(and(eq(payouts.appId, app.id), ne(payouts.status, "paid")))
  return json({
    availableCents: await appBalanceCents(svc, app.nessieAccountId),
    pendingPayoutCents: Number(pending?.cents ?? 0),
    currency: "usd",
  })
})
