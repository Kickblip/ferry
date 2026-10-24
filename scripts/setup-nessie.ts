/**
 * One-time Nessie setup for payments. Safe to re-run.
 *   1. Creates Ferry's platform account (where player payments land) and
 *      writes PLATFORM_ACCOUNT_ID into .env if it's empty.
 *   2. Creates demo player accounts (the "wallets" players pick on the
 *      checkout page) and records them in the payer_accounts table.
 *
 * Usage: npm run payments:setup [-- --players 3 --balance 500]
 * Needs NESSIE_API_KEY and DATABASE_URL in .env, and the tables pushed
 * (npm run db:push).
 */
import "dotenv/config"
import crypto from "node:crypto"
import fs from "node:fs"
import { payerAccounts } from "@/lib/schema"
import { toNessieAmount } from "@/lib/payments/money"
import { getServices } from "@/lib/payments/services"

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? Number(process.argv[i + 1]) : fallback
}

async function main() {
  const svc = await getServices()
  const players = arg("players", 3)
  const balanceDollars = arg("balance", 500)
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
    const env = fs.readFileSync(".env", "utf8")
    fs.writeFileSync(
      ".env",
      env.replace(
        /^PLATFORM_ACCOUNT_ID=.*$/m,
        `PLATFORM_ACCOUNT_ID=${accountId}`
      )
    )
    console.log(
      `Created platform account ${accountId} and saved it to .env as PLATFORM_ACCOUNT_ID`
    )
  }

  const existing = await svc.db.select().from(payerAccounts)
  for (let i = existing.length + 1; i <= players; i++) {
    const label = `Demo Player ${i}`
    const customerId = await svc.nessie.createCustomer({
      first_name: label,
      last_name: `Ferry ${tag}`,
    })
    const accountId = await svc.nessie.createAccount(customerId, {
      nickname: `${label} ${tag}`,
      balance: toNessieAmount(
        balanceDollars * 100,
        svc.config.nessieAmountUnit
      ),
    })
    await svc.db
      .insert(payerAccounts)
      .values({ nessieAccountId: accountId, label })
    console.log(`Created ${label}: ${accountId} with $${balanceDollars}`)
  }
  if (existing.length >= players) {
    console.log(
      `${existing.length} demo player account(s) already exist; none added.`
    )
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
