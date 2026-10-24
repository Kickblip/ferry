import { PGlite } from "@electric-sql/pglite"
import { defineRelations } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { pushSchema } from "drizzle-kit/api-postgres"
import * as schema from "@/lib/schema"
import { apps, payerAccounts, products } from "@/lib/schema"
import { generateApiKey, registerApiKey } from "@/lib/payments/api-keys"
import { loadConfig } from "@/lib/payments/config"
import { FakeNessie } from "@/lib/payments/nessie/fake"
import { setServices, type Db, type Services } from "@/lib/payments/services"
import { verifyWebhook } from "@/lib/payments/webhooks"

export interface Webhook {
  url: string
  body: string
  signature: string | null
  event: {
    id: string
    type: string
    data: { payment: { id: string; status: string } }
  }
}

/**
 * A complete payments environment: a real Postgres (PGlite, in memory) with
 * Ferry's schema, the fake Nessie, a controllable clock, and a fake fetch that
 * records webhooks. One app with a product, an API key and a demo player.
 */
export async function createHarness() {
  const client = new PGlite()
  const db = drizzle({
    client,
    relations: defineRelations(schema),
  }) as unknown as Db
  const { apply } = await pushSchema(schema, db as never)
  await apply()

  const nessie = new FakeNessie()
  const platformAccountId = nessie.addAccount("platform", 0)
  const playerAccountId = nessie.addAccount("player", 50_000) // $500.00 in cents
  const poorPlayerAccountId = nessie.addAccount("poor player", 100) // $1.00

  let now = new Date("2026-10-25T12:00:00Z")
  const webhooks: Webhook[] = []
  let webhookStatus = 200
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const body = String(init?.body ?? "")
    const headers = new Headers(init?.headers)
    webhooks.push({
      url: String(url),
      body,
      signature: headers.get("X-Ferry-Signature"),
      event: JSON.parse(body),
    })
    return new Response(null, { status: webhookStatus })
  }) as typeof fetch

  const svc: Services = {
    config: {
      ...loadConfig({ NODE_ENV: "test" }),
      nessieMode: "fake",
      platformAccountId,
      platformFeeBps: 500,
      publicBaseUrl: "https://ferry.test",
      internalToken: "test-internal-token",
    },
    db,
    nessie,
    fetch: fakeFetch,
    now: () => now,
  }
  setServices(svc)

  const [app] = await db
    .insert(apps)
    .values({
      ownerId: "user_test",
      name: "Pixel Quest",
      webhookUrl: "https://game.test/webhook",
    })
    .returning()
  const [product] = await db
    .insert(products)
    .values({ appId: app.id, name: "550 Gems", price: 499 })
    .returning()
  const apiKey = generateApiKey()
  await registerApiKey(db, app.id, apiKey)
  await db.insert(payerAccounts).values([
    { nessieAccountId: playerAccountId, label: "Demo Player 1" },
    { nessieAccountId: poorPlayerAccountId, label: "Broke Player" },
  ])

  return {
    svc,
    db,
    nessie,
    app,
    product,
    apiKey,
    platformAccountId,
    playerAccountId,
    poorPlayerAccountId,
    webhooks,
    setWebhookStatus: (status: number) => (webhookStatus = status),
    advance: (ms: number) => (now = new Date(now.getTime() + ms)),
    /** Calls a route handler the way Next.js would. */
    async call<T = Record<string, unknown>>(
      // Each route types its own params; `never` accepts any of them.
      handler: (req: Request, ctx: never) => Promise<Response>,
      opts: {
        method?: string
        path?: string
        body?: unknown
        key?: string | null
        params?: Record<string, string>
      } = {}
    ): Promise<{ status: number; body: T }> {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }
      const key = opts.key === undefined ? apiKey : opts.key
      if (key) headers.Authorization = `Bearer ${key}`
      const res = await handler(
        new Request(`https://ferry.test${opts.path ?? "/"}`, {
          method: opts.method ?? (opts.body ? "POST" : "GET"),
          headers,
          body: opts.body ? JSON.stringify(opts.body) : undefined,
        }),
        { params: Promise.resolve(opts.params ?? {}) } as never
      )
      return { status: res.status, body: (await res.json()) as T }
    },
    verify: (w: Webhook, secret: string) =>
      verifyWebhook(secret, w.signature, w.body, now.getTime()),
    close: () => client.close(),
  }
}

export type Harness = Awaited<ReturnType<typeof createHarness>>

/** Balance in cents the way Ferry computes it: opening + deposits − withdrawals. */
export function fakeBalance(nessie: FakeNessie, accountId: string) {
  const sum = (m: Map<string, { amount: number }[]>) =>
    (m.get(accountId) ?? []).reduce((t, x) => t + x.amount, 0)
  return (
    nessie.accounts.get(accountId)!.balance +
    sum(nessie.deposits) -
    sum(nessie.withdrawals)
  )
}
