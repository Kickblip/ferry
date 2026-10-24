import { ApiError } from "@/lib/payments/errors"
import { appRoute, json } from "@/lib/payments/http"
import { publicDelivery } from "@/lib/payments/views"
import { retryDelivery } from "@/lib/payments/webhooks"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Re-sends a webhook on the next worker pass (e.g. after fixing the endpoint). */
export const POST = appRoute<
  RouteContext<"/api/v1/webhook-deliveries/[id]/retry">
>(async (_request, svc, app, ctx) => {
  const { id } = await ctx.params
  const row = UUID.test(id) ? await retryDelivery(svc, app.id, id) : undefined
  if (!row)
    throw new ApiError(404, "delivery_not_found", `No webhook delivery ${id}`)
  return json(publicDelivery(row))
})
