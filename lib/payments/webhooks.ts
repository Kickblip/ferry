import crypto from "node:crypto"
import { and, eq, isNull, lte, or } from "drizzle-orm"
import { apps, webhookDeliveries } from "@/lib/schema"
import type { App } from "@/lib/payments/api-keys"
import { nextAttemptAt, WEBHOOK_MAX_ATTEMPTS } from "@/lib/payments/retry"
import type { Services, Tx } from "@/lib/payments/services"
import type { WebhookEventType } from "@/lib/payments/types"
import { publicPayment, type Payment } from "@/lib/payments/views"

export const SIGNATURE_HEADER = "X-Ferry-Signature"
const TOLERANCE_SECONDS = 300

/**
 * Signature header value: `t=<unix seconds>,v1=<hex HMAC-SHA256 of
 * "<t>.<raw body>" keyed with the app's webhook secret>`.
 */
export function signWebhook(secret: string, body: string, timestamp: number) {
  const mac = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")
  return `t=${timestamp},v1=${mac}`
}

/**
 * What a developer's server runs to check a webhook. Rejects tampered bodies
 * and stale (replayed) requests.
 */
export function verifyWebhook(
  secret: string,
  header: string | null,
  body: string,
  now = Date.now()
): boolean {
  const parts = Object.fromEntries(
    (header ?? "").split(",").map((p) => p.split("=") as [string, string])
  )
  const timestamp = Number(parts.t)
  if (
    !parts.v1 ||
    !Number.isFinite(timestamp) ||
    Math.abs(now / 1000 - timestamp) > TOLERANCE_SECONDS
  ) {
    return false
  }
  const expected = Buffer.from(
    signWebhook(secret, body, timestamp).split("v1=")[1]
  )
  const actual = Buffer.from(parts.v1)
  return (
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  )
}

/** Queues an event in the same transaction as the payment change it reports. */
export async function enqueueWebhook(
  tx: Tx,
  app: App,
  type: WebhookEventType,
  payment: Payment,
  now: Date
) {
  if (!app.webhookUrl) return
  const eventId = `evt_${crypto.randomBytes(12).toString("hex")}`
  const payload = JSON.stringify({
    id: eventId,
    type,
    created: now.toISOString(),
    data: { payment: publicPayment(payment) },
  })
  await tx.insert(webhookDeliveries).values({
    appId: app.id,
    eventId,
    type,
    paymentId: payment.id,
    payload,
    status: "pending",
    createdAt: now,
  })
}

/**
 * Sends every pending delivery that's due. Any 2xx counts as delivered;
 * anything else is retried with backoff, up to WEBHOOK_MAX_ATTEMPTS.
 */
export async function deliverDueWebhooks(svc: Services) {
  const now = svc.now()
  const due = await svc.db
    .select({ delivery: webhookDeliveries, app: apps })
    .from(webhookDeliveries)
    .innerJoin(apps, eq(apps.id, webhookDeliveries.appId))
    .where(
      and(
        eq(webhookDeliveries.status, "pending"),
        or(
          isNull(webhookDeliveries.nextAttemptAt),
          lte(webhookDeliveries.nextAttemptAt, now)
        )
      )
    )
    .limit(50)

  for (const { delivery, app } of due) {
    // Claim it so a second worker doesn't send the same delivery concurrently.
    const claimed = await svc.db
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(now.getTime() + 30_000) })
      .where(
        and(
          eq(webhookDeliveries.id, delivery.id),
          eq(webhookDeliveries.status, "pending"),
          or(
            isNull(webhookDeliveries.nextAttemptAt),
            lte(webhookDeliveries.nextAttemptAt, now)
          )
        )
      )
      .returning({ id: webhookDeliveries.id })
    if (claimed.length)
      await sendDelivery(
        svc,
        delivery.id,
        delivery.payload,
        delivery.attempts,
        app
      )
  }
}

async function sendDelivery(
  svc: Services,
  id: string,
  payload: string,
  previousAttempts: number,
  app: App
) {
  const now = svc.now()
  let responseStatus: number | null = null
  let error: string | null = null
  if (!app.webhookUrl || !app.webhookSecret) {
    error = "App has no webhook URL"
  } else {
    try {
      const res = await svc.fetch(app.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SIGNATURE_HEADER]: signWebhook(
            app.webhookSecret,
            payload,
            Math.floor(now.getTime() / 1000)
          ),
        },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      })
      responseStatus = res.status
      if (!res.ok) error = `HTTP ${res.status}`
    } catch (err) {
      error = (err as Error).message
    }
  }

  const attempts = previousAttempts + 1
  const exhausted = !!error && attempts >= WEBHOOK_MAX_ATTEMPTS
  await svc.db
    .update(webhookDeliveries)
    .set({
      attempts,
      responseStatus,
      lastError: error,
      status: !error ? "delivered" : exhausted ? "failed" : "pending",
      deliveredAt: error ? null : now,
      nextAttemptAt:
        error && !exhausted ? new Date(nextAttemptAt(attempts, now)) : null,
    })
    .where(eq(webhookDeliveries.id, id))
}

/** Re-queues a failed (or pending) delivery to be sent on the next worker pass. */
export async function retryDelivery(svc: Services, appId: string, id: string) {
  const [row] = await svc.db
    .update(webhookDeliveries)
    .set({ status: "pending", nextAttemptAt: null, attempts: 0 })
    .where(
      and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.appId, appId))
    )
    .returning()
  return row
}
