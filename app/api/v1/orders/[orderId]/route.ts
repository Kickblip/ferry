import { ApiError } from "@/lib/payments/errors"
import { appRoute, json } from "@/lib/payments/http"
import { getPaymentByOrder } from "@/lib/payments/queries"
import { publicPayment } from "@/lib/payments/views"

/**
 * "Is this order paid?" — the fallback if a webhook never arrives. Returns the
 * latest payment attempt for the order.
 */
export const GET = appRoute<RouteContext<"/api/v1/orders/[orderId]">>(
  async (_request, svc, app, ctx) => {
    const { orderId } = await ctx.params
    const payment = await getPaymentByOrder(svc, app.id, orderId)
    if (!payment) {
      throw new ApiError(
        404,
        "order_not_found",
        `No payment for order ${orderId}`
      )
    }
    return json(publicPayment(payment))
  }
)
