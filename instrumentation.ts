/**
 * Runs once when the Next.js server starts. Starts the payments worker
 * (retries, developer payouts, webhook deliveries) on long-running servers
 * such as `next dev` / `next start`. Set WORKER_ENABLED=false to turn it off.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  if (process.env.WORKER_ENABLED === "false") return
  const { getServices } = await import("@/lib/payments/services")
  const { startWorker } = await import("@/lib/payments/worker")
  startWorker(await getServices())
}
