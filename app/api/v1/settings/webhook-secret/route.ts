import { rotateWebhookSecret } from "@/lib/payments/apps"
import { appRoute, json } from "@/lib/payments/http"

/**
 * Creates a new webhook signing secret and returns it once. Webhooks signed
 * with the old secret stop verifying immediately.
 */
export const POST = appRoute(async (_request, svc, app) => {
  const webhookSecret = await rotateWebhookSecret(svc, app.id)
  return json({ webhookSecret })
})
