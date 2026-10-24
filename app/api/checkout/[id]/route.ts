import { json, route } from "@/lib/payments/http"
import {
  checkoutUrl,
  getCheckout,
  getPaymentApp,
} from "@/lib/payments/payments"
import { checkoutView } from "@/lib/payments/views"

/**
 * Checkout page → Ferry: load the session. Poll this while the status is
 * "processing"; each call also nudges the payment forward.
 */
export const GET = route<RouteContext<"/api/checkout/[id]">>(
  async (_request, svc, ctx) => {
    const { id } = await ctx.params
    const payment = await getCheckout(svc, id)
    return json(
      checkoutView(
        payment,
        await getPaymentApp(svc, payment),
        checkoutUrl(svc, id)
      )
    )
  }
)
