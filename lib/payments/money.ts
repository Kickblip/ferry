/** Fixed 5% platform fee, rounded to the nearest cent. */
export function feeFor(amountCents: number): number {
  return Math.round((amountCents * 5) / 100)
}

export function splitPayment(amountCents: number) {
  const feeCents = feeFor(amountCents)
  return { feeCents, netCents: amountCents - feeCents }
}
