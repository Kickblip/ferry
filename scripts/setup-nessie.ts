/**
 * One-time Nessie setup for payments. Safe to re-run.
 *   1. Creates Ferry's platform account (where simulated payments land) and
 *      writes PLATFORM_ACCOUNT_ID into .env if it's empty.
 *   2. Prepares payout accounts for existing apps.
 *
 * Usage: npm run payments:setup
 * Needs NESSIE_API_KEY and DATABASE_URL in .env, and the tables pushed
 * (npm run db:push).
 */
import "dotenv/config"
import crypto from "node:crypto"
import fs from "node:fs"
import { apps } from "@/lib/schema"
import { setupAppPayments } from "@/lib/payments/apps"
import { getServices } from "@/lib/payments/services"

async function main() {
  const svc = await getServices()
  const tag = crypto.randomBytes(4).toString("hex")

  if (svc.config.platformAccountId) {
    const account = await svc.nessie.getAccount(svc.config.platformAccountId)
    console.log(
      `Platform account already set: ${account._id} (${account.nickname})`
    )
  } else {
    const customerId = await svc.nessie.createCustomer({
      first_name: "Ferry",
      last_name: `Platform ${tag}`,
    })
    const accountId = await svc.nessie.createAccount(customerId, {
      nickname: `Ferry platform ${tag}`,
      balance: 0,
    })
    const env = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : ""
    const setting = `PLATFORM_ACCOUNT_ID=${accountId}`
    fs.writeFileSync(
      ".env",
      /^PLATFORM_ACCOUNT_ID=.*$/m.test(env)
        ? env.replace(/^PLATFORM_ACCOUNT_ID=.*$/m, setting)
        : `${env}${env.endsWith("\n") || !env ? "" : "\n"}${setting}\n`
    )
    console.log(
      `Created platform account ${accountId} and saved it to .env as PLATFORM_ACCOUNT_ID`
    )
  }

  for (const app of await svc.db.select().from(apps)) {
    await setupAppPayments(svc, app)
    console.log(`Payout account ready for ${app.name}`)
  }
  console.log(
    "Done. Restart `npm run dev` if it was running so it picks up .env changes."
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
