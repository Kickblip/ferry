import { z } from "zod"
import { json, parseBody, route } from "@/lib/payments/http"
import {
  checkoutUrl,
  confirmCheckout,
  getPaymentApp,
} from "@/lib/payments/payments"
import { checkoutView } from "@/lib/payments/views"

const confirmInput = z.object({ paymentMethodId: z.string().min(1) })

/**
 * Checkout page → Ferry: the player pays with one of their payment methods.
 * Attempts the charge and payout in this request. Repeat this POST to resume
 * unfinished steps; GET only reads status and never moves money.
 */
export const POST = route<RouteContext<"/api/checkout/[id]/confirm">>(
  async (request, svc, ctx) => {
    const { id } = await ctx.params
    const { paymentMethodId } = await parseBody(request, confirmInput)
    const payment = await confirmCheckout(svc, id, paymentMethodId)
    return json(
      checkoutView(
        payment,
        await getPaymentApp(svc, payment),
        checkoutUrl(svc, id)
      )
    )
  }
)
