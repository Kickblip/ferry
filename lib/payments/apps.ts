import crypto from "node:crypto"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { apps } from "@/lib/schema"
import type { App } from "@/lib/payments/api-keys"
import { ApiError } from "@/lib/payments/errors"
import type { Services } from "@/lib/payments/services"

const newWebhookSecret = () =>
  `whsec_${crypto.randomBytes(24).toString("base64url")}`

/**
 * Makes sure an app can be paid: it needs a Nessie account for payouts and a
 * webhook signing secret. Both are created on first use, so the existing
 * "create app" flow doesn't have to change.
 */
export async function ensurePaymentSetup(
  svc: Services,
  app: App
): Promise<App> {
  if (app.nessieAccountId && app.webhookSecret) return app
  let nessieAccountId = app.nessieAccountId
  if (!nessieAccountId) {
    // The app id makes the name unique: Nessie returns no id on create, so the
    // client finds the new customer again by name.
    const customerId = await svc.nessie.createCustomer({
      first_name: app.name.slice(0, 40) || "Ferry app",
      last_name: app.id,
    })
    nessieAccountId = await svc.nessie.createAccount(customerId, {
      nickname: `Ferry payouts ${app.id}`,
      balance: 0,
    })
  }
  const [updated] = await svc.db
    .update(apps)
    .set({
      nessieAccountId,
      webhookSecret: app.webhookSecret ?? newWebhookSecret(),
    })
    .where(eq(apps.id, app.id))
    .returning()
  return updated
}

export const updatePaymentSettingsInput = z.object({
  webhookUrl: z.url().nullable().optional(),
})

export async function updatePaymentSettings(
  svc: Services,
  appId: string,
  input: z.infer<typeof updatePaymentSettingsInput>
) {
  const [updated] = await svc.db
    .update(apps)
    .set({ webhookUrl: input.webhookUrl })
    .where(eq(apps.id, appId))
    .returning()
  if (!updated) throw new ApiError(404, "app_not_found", `No app ${appId}`)
  return updated
}

/** Returns the new secret once; the developer needs it to verify webhooks. */
export async function rotateWebhookSecret(svc: Services, appId: string) {
  const secret = newWebhookSecret()
  await svc.db
    .update(apps)
    .set({ webhookSecret: secret })
    .where(eq(apps.id, appId))
  return secret
}
