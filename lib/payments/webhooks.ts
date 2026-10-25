import { createHmac } from "node:crypto"
import { eq } from "drizzle-orm"
import { apps, webhookDeliveries } from "@/lib/schema"
import type { Services } from "@/lib/payments/services"
import { publicPayment, type Payment } from "@/lib/payments/views"
import { postWebhook } from "@/lib/payments/webhook-http"

export function paymentWebhookBody(
  payment: Payment,
  eventId: string,
  createdAt: Date
) {
  return JSON.stringify({
    id: eventId,
    type: "payment.succeeded",
    createdAt: createdAt.toISOString(),
    data: publicPayment(payment),
  })
}

export function signWebhook(body: string, secret: string, timestamp: number) {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")
  return `t=${timestamp},v1=${signature}`
}

export async function deliverPaymentWebhook(
  svc: Services,
  payment: Payment
): Promise<void> {
  if (payment.status !== "SUCCEEDED" || !payment.settledAt) return
  const [app] = await svc.db
    .select({ url: apps.webhookUrl, secret: apps.webhookSecret })
    .from(apps)
    .where(eq(apps.id, payment.appId))
  if (!app?.url || !app.secret) return

  // Claim the event before sending so repeated confirmations cannot send it twice.
  const [delivery] = await svc.db
    .insert(webhookDeliveries)
    .values({
      appId: payment.appId,
      paymentId: payment.id,
      callbackUrl: app.url,
    })
    .onConflictDoNothing({ target: webhookDeliveries.paymentId })
    .returning()
  if (!delivery) return

  const body = paymentWebhookBody(payment, delivery.id, delivery.createdAt)
  const timestamp = Math.floor(svc.now().getTime() / 1000)
  let responseStatus: number | null = null
  let error: string | null = null
  try {
    responseStatus = await postWebhook(
      app.url,
      body,
      signWebhook(body, app.secret, timestamp)
    )
    if (responseStatus < 200 || responseStatus >= 300) {
      error = `Endpoint returned HTTP ${responseStatus}`
    }
  } catch {
    error = "Callback request failed or timed out"
  }

  // shortcut: delivery gets one attempt; add a durable retry worker when retries are needed.
  await svc.db
    .update(webhookDeliveries)
    .set({
      status: error ? "FAILED" : "DELIVERED",
      responseStatus,
      error,
      completedAt: svc.now(),
    })
    .where(eq(webhookDeliveries.id, delivery.id))
}
