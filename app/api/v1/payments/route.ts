import { appRoute, json, listOptions } from "@/lib/payments/http"
import { listPayments } from "@/lib/payments/queries"
import { publicPayment } from "@/lib/payments/views"

/** `?status=succeeded&limit=25&before=<ISO createdAt>` */
export const GET = appRoute(async (request, svc, app) => {
  const rows = await listPayments(svc, app.id, listOptions(request))
  return json({ data: rows.map(publicPayment) })
})
