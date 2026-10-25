import type { NessieClient, NessieTxn } from "@/lib/payments/nessie/client"
import type { Movement } from "@/lib/payments/types"

/** Transactions are tagged "<ref> <note>" so they can be found again: Nessie's create calls return no id. */
const describe = (ref: string, note: string) => `${ref} ${note}`
const findByRef = (txns: NessieTxn[], ref: string) =>
  txns.find((t) => t.description?.split(" ")[0] === ref)
const counts = (t: NessieTxn) => t.status !== "cancelled"

/** The payment row is locked by the caller. Its ID also recovers accepted-but-timed-out deposits. */
export async function settleDeposit(
  nessie: NessieClient,
  accountId: string,
  paymentId: string,
  amountCents: number
): Promise<string> {
  let deposit = findByRef(await nessie.listDeposits(accountId), paymentId)
  if (!deposit) {
    // shortcut: a timed-out write that is still invisible in Nessie can duplicate on retry.
    // Strict deduplication would need Nessie idempotency or reconciliation before another write.
    await nessie.createDeposit(accountId, {
      amount: amountCents,
      description: describe(paymentId, "Simulated checkout payment"),
    })
    deposit = findByRef(await nessie.listDeposits(accountId), paymentId)
  }
  if (!deposit || deposit.status !== "completed" || !deposit._id) {
    throw new Error("Nessie deposit is awaiting confirmation")
  }
  if (deposit.amount !== amountCents) {
    throw new Error("Nessie deposit amount does not match the checkout")
  }
  return deposit._id
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

/** The payout row is locked by the caller; each leg reuses its tagged transaction on retry. */
export async function settleTransfer(nessie: NessieClient, movement: Movement) {
  const { ref, fromAccountId, toAccountId, amountCents } = movement
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0 ||
    fromAccountId === toAccountId
  ) {
    throw new Error("Invalid withdrawal")
  }

  let withdrawal = findByRef(await nessie.listWithdrawals(fromAccountId), ref)
  if (!withdrawal) {
    if ((await balanceCents(nessie, fromAccountId)) < amountCents) {
      throw new Error("Ferry has insufficient settled funds")
    }
    // shortcut: invisible timed-out writes can duplicate; strict recovery needs Nessie idempotency.
    await nessie.createWithdrawal(fromAccountId, {
      amount: amountCents,
      description: describe(ref, "App withdrawal"),
    })
    withdrawal = findByRef(await nessie.listWithdrawals(fromAccountId), ref)
  }
  if (
    !withdrawal?._id ||
    withdrawal.status !== "completed" ||
    withdrawal.amount !== amountCents
  ) {
    throw new Error("Nessie withdrawal is awaiting confirmation")
  }
  movement.withdrawal = { status: "COMPLETED", nessieId: withdrawal._id }

  let deposit = findByRef(await nessie.listDeposits(toAccountId), ref)
  if (!deposit) {
    await nessie.createDeposit(toAccountId, {
      amount: amountCents,
      description: describe(ref, "App withdrawal"),
    })
    deposit = findByRef(await nessie.listDeposits(toAccountId), ref)
  }
  if (
    !deposit?._id ||
    deposit.status !== "completed" ||
    deposit.amount !== amountCents
  ) {
    throw new Error("Nessie deposit is awaiting confirmation")
  }
  movement.deposit = { status: "COMPLETED", nessieId: deposit._id }
}
