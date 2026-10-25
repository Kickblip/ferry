import { ApiError, NessieError } from "@/lib/payments/errors"
import type { NessieClient, NessieTxn } from "@/lib/payments/nessie/client"
import type { Movement } from "@/lib/payments/types"

/** Transactions are tagged "<ref> <note>" so they can be found again: Nessie's create calls return no id. */
const describe = (ref: string, note: string) => `${ref} ${note}`
const findByRef = (txns: NessieTxn[], ref: string) =>
  txns.find((t) => t.description?.split(" ")[0] === ref)
const counts = (t: NessieTxn) => t.status !== "cancelled"

export function newMovement(
  ref: string,
  fromAccountId: string,
  toAccountId: string,
  amountCents: number
): Movement {
  return {
    ref,
    fromAccountId,
    toAccountId,
    amountCents,
    withdrawal: { status: "PENDING" },
    deposit: { status: "PENDING" },
  }
}

/**
 * Nessie never updates an account's stored balance, so the real balance is the opening balance plus
 * deposits minus withdrawals, read live from Nessie.
 */
export async function balanceCents(
  nessie: NessieClient,
  accountId: string
): Promise<number> {
  const [account, deposits, withdrawals] = await Promise.all([
    nessie.getAccount(accountId),
    nessie.listDeposits(accountId),
    nessie.listWithdrawals(accountId),
  ])
  const sum = (txns: NessieTxn[]) =>
    txns.filter(counts).reduce((total, t) => total + t.amount, 0)
  return account.balance + sum(deposits) - sum(withdrawals)
}

/**
 * Reuses tagged bank records on retries. The caller serializes each movement.
 * Updates the movement in place so partial progress survives a later error.
 */
export async function advanceMovement(
  nessie: NessieClient,
  movement: Movement,
  options: { note: string; checkFunds?: boolean }
): Promise<Movement> {
  const next = movement
  const amount = movement.amountCents

  if (next.withdrawal.status !== "COMPLETED") {
    let existing = findByRef(
      await nessie.listWithdrawals(movement.fromAccountId),
      movement.ref
    )
    if (!existing) {
      if (
        options.checkFunds &&
        (await balanceCents(nessie, movement.fromAccountId)) <
          movement.amountCents
      ) {
        throw new ApiError(
          402,
          "INSUFFICIENT_FUNDS",
          "The payment was declined"
        )
      }
      try {
        await nessie.createWithdrawal(movement.fromAccountId, {
          amount,
          description: describe(movement.ref, options.note),
        })
      } catch (err) {
        if (err instanceof NessieError && !err.retryable) {
          throw new ApiError(
            402,
            "NESSIE_REJECTED",
            "The payment was declined by the bank"
          )
        }
        throw err
      }
      existing = findByRef(
        await nessie.listWithdrawals(movement.fromAccountId),
        movement.ref
      )
    }
    if (existing)
      next.withdrawal = {
        status: existing.status === "completed" ? "COMPLETED" : "PENDING",
        nessieId: existing._id,
      }
    if (next.withdrawal.status !== "COMPLETED") return next
  }

  if (next.deposit.status !== "COMPLETED") {
    let existing = findByRef(
      await nessie.listDeposits(movement.toAccountId),
      movement.ref
    )
    if (!existing) {
      await nessie.createDeposit(movement.toAccountId, {
        amount,
        description: describe(movement.ref, options.note),
      })
      existing = findByRef(
        await nessie.listDeposits(movement.toAccountId),
        movement.ref
      )
    }
    if (existing)
      next.deposit = {
        status: existing.status === "completed" ? "COMPLETED" : "PENDING",
        nessieId: existing._id,
      }
  }
  return next
}

export const isComplete = (m: Movement) =>
  m.withdrawal.status === "COMPLETED" && m.deposit.status === "COMPLETED"
