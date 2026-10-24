import { internalRoute, json } from "@/lib/payments/http"
import { tick } from "@/lib/payments/worker"

/**
 * Runs one pass of background payment work. Locally the worker in
 * instrumentation.ts does this every few seconds; on serverless hosting
 * (where nothing runs between requests) point a cron at this endpoint.
 */
export const POST = internalRoute(async (_request, svc) => {
  await tick(svc)
  return json({ ok: true })
})
