import type { PgAsyncDatabase } from "drizzle-orm/pg-core"
import { loadConfig, type Config } from "@/lib/payments/config"
import {
  HttpNessieClient,
  type NessieClient,
} from "@/lib/payments/nessie/client"
import { FakeNessie } from "@/lib/payments/nessie/fake"

/** Any Drizzle Postgres database: Neon in the app, PGlite in tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgAsyncDatabase<any, any>
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

/** Everything the payment logic depends on, so tests can swap in fakes. */
export interface Services {
  config: Config
  db: Db
  nessie: NessieClient
  fetch: typeof fetch
  now: () => Date
}

const globalForServices = globalThis as unknown as {
  __paymentServices?: Services
}

export async function getServices(): Promise<Services> {
  if (!globalForServices.__paymentServices) {
    const config = loadConfig()
    // Imported lazily so tests (which inject their own db) never open a Neon pool.
    const { db } = await import("@/lib/db")
    globalForServices.__paymentServices = {
      config,
      db,
      nessie:
        config.nessieMode === "fake"
          ? new FakeNessie()
          : new HttpNessieClient(config.nessieBaseUrl, config.nessieApiKey),
      fetch: (...args) => fetch(...args),
      now: () => new Date(),
    }
  }
  return globalForServices.__paymentServices
}

/** Tests only: replace the services used by route handlers. */
export function setServices(services: Services | undefined) {
  globalForServices.__paymentServices = services
}
