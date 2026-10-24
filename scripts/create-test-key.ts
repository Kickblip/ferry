/**
 * Creates an API key for an app so the payments API can be tested before the
 * dashboard's key screen exists. Prints the key once; only its hash is stored.
 *
 * Usage: npm run payments:test-key            (lists apps)
 *        npm run payments:test-key -- <appId>
 */
import "dotenv/config"
import { eq } from "drizzle-orm"
import { apps } from "@/lib/schema"
import { generateApiKey, registerApiKey } from "@/lib/payments/api-keys"
import { getServices } from "@/lib/payments/services"

async function main() {
  const { db } = await getServices()
  const appId = process.argv[2]
  if (!appId) {
    const all = await db.select({ id: apps.id, name: apps.name }).from(apps)
    console.log(
      all.length ? "Apps:" : "No apps yet — create one in the dashboard first."
    )
    for (const a of all) console.log(`  ${a.id}  ${a.name}`)
    console.log(
      "\nRun again with an app id: npm run payments:test-key -- <appId>"
    )
    process.exit(0)
  }
  const [app] = await db.select().from(apps).where(eq(apps.id, appId))
  if (!app) throw new Error(`No app ${appId}`)
  const key = generateApiKey()
  await registerApiKey(db, app.id, key, "test key (script)")
  console.log(
    `API key for "${app.name}" (shown once, store it somewhere safe):\n\n  ${key}\n`
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
