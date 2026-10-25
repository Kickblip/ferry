import { json, route } from "@/lib/payments/http"
import {
  checkoutUrl,
  confirmCheckout,
  getPaymentApp,
} from "@/lib/payments/payments"
import { checkoutView } from "@/lib/payments/views"

/** Simulates payment, then credits Ferry. Repeating this POST resumes an unfinished deposit. */
export const POST = route<RouteContext<"/api/checkout/[id]/confirm">>(
  async (_request, svc, ctx) => {
    const { id } = await ctx.params
    const payment = await confirmCheckout(svc, id)
    return json(
      checkoutView(
        payment,
        await getPaymentApp(svc, payment),
        checkoutUrl(svc, id)
      )
    )
  }
)
