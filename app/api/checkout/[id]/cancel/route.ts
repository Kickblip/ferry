import { json, route } from "@/lib/payments/http"
import {
  cancelCheckout,
  checkoutUrl,
  getPaymentApp,
} from "@/lib/payments/payments"
import { checkoutView } from "@/lib/payments/views"

/** Checkout page → Ferry: the player backs out before paying. */
export const POST = route<RouteContext<"/api/checkout/[id]/cancel">>(
  async (_request, svc, ctx) => {
    const { id } = await ctx.params
    const payment = await cancelCheckout(svc, id)
    return json(
      checkoutView(
        payment,
        await getPaymentApp(svc, payment),
        checkoutUrl(svc, id)
      )
    )
  }
)
