import type { AmountUnit } from "@/lib/payments/config"
import { ApiError } from "@/lib/payments/errors"

/** Platform fee in cents, rounded half up. All money in this service is integer cents. */
export function feeFor(amountCents: number, feeBps: number): number {
  return Math.floor((amountCents * feeBps + 5000) / 10000)
}

export function splitPayment(amountCents: number, feeBps: number) {
  const feeCents = feeFor(amountCents, feeBps)
  return { feeCents, netCents: amountCents - feeCents }
}

/** Converts cents to the whole-number amount Nessie stores. */
export function toNessieAmount(cents: number, unit: AmountUnit): number {
  if (unit === "cents") return cents
  if (cents % 100 !== 0) {
    throw new ApiError(
      400,
      "amount_not_whole_dollars",
      "NESSIE_AMOUNT_UNIT=dollars only supports whole-dollar amounts"
    )
  }
  return cents / 100
}

export function fromNessieAmount(amount: number, unit: AmountUnit): number {
  return unit === "cents" ? Math.round(amount) : Math.round(amount * 100)
}
