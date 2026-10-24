import type { AmountUnit } from "@/lib/payments/config"
import { ApiError } from "@/lib/payments/errors"
import { fromNessieAmount, toNessieAmount } from "@/lib/payments/money"
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
    withdrawal: { status: "pending" },
    deposit: { status: "pending" },
  }
}

/**
 * Nessie never updates an account's stored balance, so the real balance is the opening balance plus
 * deposits minus withdrawals, read live from Nessie.
 */
export async function balanceCents(
  nessie: NessieClient,
  accountId: string,
  unit: AmountUnit
): Promise<number> {
  const [account, deposits, withdrawals] = await Promise.all([
    nessie.getAccount(accountId),
    nessie.listDeposits(accountId),
    nessie.listWithdrawals(accountId),
  ])
  const sum = (txns: NessieTxn[]) =>
    txns.filter(counts).reduce((total, t) => total + t.amount, 0)
  return fromNessieAmount(
    account.balance + sum(deposits) - sum(withdrawals),
    unit
  )
}

/**
 * Moves money as a withdrawal from the source and a deposit to the destination. Safe to call any
 * number of times for the same movement: before writing, each leg checks Nessie for a transaction
 * already tagged with this movement's ref, so a retry after a timeout never charges twice.
 * Returns the movement with updated leg states; it's complete when both legs are "completed".
 */
export async function advanceMovement(
  nessie: NessieClient,
  movement: Movement,
  unit: AmountUnit,
  options: { note: string; checkFunds?: boolean }
): Promise<Movement> {
  const next = structuredClone(movement)
  const amount = toNessieAmount(movement.amountCents, unit)

  if (next.withdrawal.status !== "completed") {
    let existing = findByRef(
      await nessie.listWithdrawals(movement.fromAccountId),
      movement.ref
    )
    if (!existing) {
      if (
        options.checkFunds &&
        (await balanceCents(nessie, movement.fromAccountId, unit)) <
          movement.amountCents
      ) {
        throw new ApiError(
          402,
          "insufficient_funds",
          "The payment was declined"
        )
      }
      await nessie.createWithdrawal(movement.fromAccountId, {
        amount,
        description: describe(movement.ref, options.note),
      })
      existing = findByRef(
        await nessie.listWithdrawals(movement.fromAccountId),
        movement.ref
      )
    }
    if (existing)
      next.withdrawal = {
        status: existing.status === "completed" ? "completed" : "pending",
        nessieId: existing._id,
      }
    if (next.withdrawal.status !== "completed") return next
  }

  if (next.deposit.status !== "completed") {
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
        status: existing.status === "completed" ? "completed" : "pending",
        nessieId: existing._id,
      }
  }
  return next
}

export const isComplete = (m: Movement) =>
  m.withdrawal.status === "completed" && m.deposit.status === "completed"
