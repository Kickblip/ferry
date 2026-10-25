/**
 * One side of a money movement in Nessie. Nessie has no account-to-account
 * transfer endpoint, so each movement is a withdrawal from the source plus a
 * deposit to the destination, tagged with `ref` in the description so they can
 * be found again (Nessie's create calls don't return ids).
 */
export interface MovementLeg {
  status: "PENDING" | "COMPLETED"
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
