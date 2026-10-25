import { json, route } from "@/lib/payments/http"
import { getCheckout, listPaymentMethods } from "@/lib/payments/payments"

/**
 * The saved payment methods a player can pick (demo Nessie accounts), shown
 * the way a card processor shows saved cards: a label and an opaque id. Never
 * account numbers or balances; funds are checked server-side at confirm.
 */
export const GET = route<RouteContext<"/api/checkout/[id]/payment-methods">>(
  async (_request, svc, ctx) => {
    await getCheckout(svc, (await ctx.params).id) // 404s for unknown sessions
    return json({ data: await listPaymentMethods(svc) })
  }
)
