/** Convert a USD form value to the integer cents stored by products. */
export function productPriceCents(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    !/^(?:\d+|\d*\.\d{1,2})$/.test(value.trim())
  ) {
    return null
  }
  const [dollars, fraction = ""] = value.trim().split(".")
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"))
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 2_147_483_647
    ? cents
    : null
}
