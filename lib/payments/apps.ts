import { eq } from "drizzle-orm"
import { apps } from "@/lib/schema"
import type { App } from "@/lib/payments/api-keys"
import type { Services } from "@/lib/payments/services"

/** Prepare payouts when creating an app or running payments:setup. */
export async function setupAppPayments(svc: Services, app: App): Promise<App> {
  if (app.nessieAccountId) return app
  const customerId = await svc.nessie.createCustomer({
    first_name: app.name.slice(0, 40) || "Ferry app",
    last_name: app.id,
  })
  const nessieAccountId = await svc.nessie.createAccount(customerId, {
    nickname: `Ferry payouts ${app.id}`,
    balance: 0,
  })
  const [updated] = await svc.db
    .update(apps)
    .set({ nessieAccountId })
    .where(eq(apps.id, app.id))
    .returning()
  return updated
}
