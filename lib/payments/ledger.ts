import type { NessieClient, NessieTxn } from "@/lib/payments/nessie/client"

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
