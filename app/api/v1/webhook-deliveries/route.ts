import { appRoute, json, listOptions } from "@/lib/payments/http"
import { listDeliveries } from "@/lib/payments/queries"
import { publicDelivery } from "@/lib/payments/views"

export const GET = appRoute(async (request, svc, app) => {
  const rows = await listDeliveries(svc, app.id, listOptions(request))
  return json({ data: rows.map(publicDelivery) })
})
