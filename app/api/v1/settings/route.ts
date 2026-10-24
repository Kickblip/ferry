import {
  ensurePaymentSetup,
  updatePaymentSettings,
  updatePaymentSettingsInput,
} from "@/lib/payments/apps"
import { appRoute, json, parseBody } from "@/lib/payments/http"
import { publicPaymentSettings } from "@/lib/payments/views"

export const GET = appRoute(async (_request, _svc, app) =>
  json(publicPaymentSettings(app))
)

/** `{ "webhookUrl": "https://game.example/ferry-webhook" }` (null to remove) */
export const PATCH = appRoute(async (request, svc, app) => {
  const input = await parseBody(request, updatePaymentSettingsInput)
  await ensurePaymentSetup(svc, app)
  const updated = await updatePaymentSettings(svc, app.id, input)
  return json(publicPaymentSettings(updated))
})
