export type PaymentStatus =
  | "requires_confirmation"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "expired"
export type LegStatus = "pending" | "completed" | "failed"
export type PayoutStatus = "pending" | "processing" | "paid"
export type DeliveryStatus = "pending" | "delivered" | "failed"
export type WebhookEventType = "payment.succeeded" | "payment.failed"

/**
 * One side of a money movement in Nessie. Nessie has no account-to-account
 * transfer endpoint, so each movement is a withdrawal from the source plus a
 * deposit to the destination, tagged with `ref` in the description so they can
 * be found again (Nessie's create calls don't return ids).
 */
export interface MovementLeg {
  status: LegStatus
  nessieId?: string
}

export interface Movement {
  ref: string
  fromAccountId: string
  toAccountId: string
  amountCents: number
  withdrawal: MovementLeg
  deposit: MovementLeg
}
