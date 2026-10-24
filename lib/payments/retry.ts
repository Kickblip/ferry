/** Backoff for payment/payout retries and webhook deliveries: 5s, 15s, 1m, 5m, 15m, 30m, then hourly. */
const STEPS_MS = [5_000, 15_000, 60_000, 300_000, 900_000, 1_800_000]

export function nextAttemptAt(attempts: number, now: Date): string {
  const delay =
    STEPS_MS[Math.min(attempts - 1, STEPS_MS.length - 1)] ?? 3_600_000
  return new Date(
    now.getTime() + (attempts > STEPS_MS.length ? 3_600_000 : delay)
  ).toISOString()
}

export const isDue = (at: string | undefined, now: Date) =>
  !at || Date.parse(at) <= now.getTime()

export const WEBHOOK_MAX_ATTEMPTS = 8
