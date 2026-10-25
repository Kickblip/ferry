import { appRoute, json, parseBody } from "@/lib/payments/http"
import {
  checkoutUrl,
  createCheckout,
  createCheckoutInput,
} from "@/lib/payments/payments"
import { publicPayment } from "@/lib/payments/views"

/** Game server → Ferry: start a checkout for one of the app's products. */
export const POST = appRoute(async (request, svc, app) => {
  const input = await parseBody(request, createCheckoutInput)
  const { payment, created } = await createCheckout(svc, app, input)
  return json(
    { ...publicPayment(payment), checkoutUrl: checkoutUrl(svc, payment.id) },
    created ? 201 : 200
  )
})
