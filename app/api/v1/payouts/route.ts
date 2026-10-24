import { appRoute, json, listOptions } from "@/lib/payments/http"
import { listPayouts } from "@/lib/payments/queries"
import { publicPayout } from "@/lib/payments/views"

export const GET = appRoute(async (request, svc, app) => {
  const rows = await listPayouts(svc, app.id, listOptions(request))
  return json({ data: rows.map(publicPayout) })
})
