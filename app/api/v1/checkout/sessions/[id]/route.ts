import { ApiError } from "@/lib/payments/errors"
import { appRoute, json } from "@/lib/payments/http"
import { checkoutUrl, getCheckout } from "@/lib/payments/payments"
import { publicPayment } from "@/lib/payments/views"

export const GET = appRoute<RouteContext<"/api/v1/checkout/sessions/[id]">>(
  async (_request, svc, app, ctx) => {
    const { id } = await ctx.params
    const payment = await getCheckout(svc, id)
    if (payment.appId !== app.id) {
      throw new ApiError(404, "payment_not_found", `No checkout session ${id}`)
    }
    return json({
      ...publicPayment(payment),
      checkoutUrl: checkoutUrl(svc, id),
    })
  }
)
