export type AmountUnit = "cents" | "dollars"

export interface Config {
  nessieApiKey: string
  nessieBaseUrl: string
  /** "live" talks to Nessie; "fake" uses the in-memory stand-in (tests, offline demos). */
  nessieMode: "live" | "fake"
  /**
   * Nessie stores amounts as whole numbers. "cents" records 499 for $4.99 so
   * microtransactions work; "dollars" records real dollars and rejects amounts
   * that aren't whole dollars.
   */
  nessieAmountUnit: AmountUnit
  /** Nessie account that receives player payments before developers are paid out. */
  platformAccountId: string
  /** Platform fee in basis points (500 = 5%). */
  platformFeeBps: number
  /** Public origin of this app, used to build checkout URLs. */
  publicBaseUrl: string
  /** Path of the player-facing checkout page; the payment id is appended. */
  checkoutPath: string
  sessionTtlMinutes: number
  /** Bearer token for /api/internal/* (cron, tooling). */
  internalToken: string
  workerEnabled: boolean
  workerIntervalMs: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    nessieApiKey: env.NESSIE_API_KEY ?? "",
    nessieBaseUrl: (
      env.NESSIE_BASE_URL || "https://api.nessieisreal.com"
    ).replace(/\/$/, ""),
    nessieMode: env.NESSIE_MODE === "fake" ? "fake" : "live",
    nessieAmountUnit:
      env.NESSIE_AMOUNT_UNIT === "dollars" ? "dollars" : "cents",
    platformAccountId: env.PLATFORM_ACCOUNT_ID ?? "",
    platformFeeBps: Number(env.PLATFORM_FEE_BPS || 500),
    publicBaseUrl: (env.PUBLIC_BASE_URL || "http://localhost:3000").replace(
      /\/$/,
      ""
    ),
    checkoutPath: env.CHECKOUT_PATH || "/checkout",
    sessionTtlMinutes: Number(env.SESSION_TTL_MINUTES || 30),
    internalToken: env.INTERNAL_TOKEN ?? "",
    workerEnabled: env.WORKER_ENABLED !== "false",
    workerIntervalMs: Number(env.WORKER_INTERVAL_MS || 2000),
  }
}
