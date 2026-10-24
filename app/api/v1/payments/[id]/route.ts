import { ApiError } from "@/lib/payments/errors"
import { appRoute, json } from "@/lib/payments/http"
import { getPaymentForApp } from "@/lib/payments/queries"
import { publicPayment } from "@/lib/payments/views"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET = appRoute<RouteContext<"/api/v1/payments/[id]">>(
  async (_request, svc, app, ctx) => {
    const { id } = await ctx.params
    const payment = UUID.test(id)
      ? await getPaymentForApp(svc, app.id, id)
      : undefined
    if (!payment)
      throw new ApiError(404, "payment_not_found", `No payment ${id}`)
    return json(publicPayment(payment))
  }
)
