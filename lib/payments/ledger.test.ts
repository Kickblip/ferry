import assert from "node:assert/strict"
import test from "node:test"
import { balanceCents, settleTransfer } from "./ledger"
import type { NessieClient, NessieTxn, NewTxn } from "./nessie/client"
import type { Movement } from "./types"

function fixture() {
  const withdrawals: NessieTxn[] = []
  const deposits: NessieTxn[] = []
  const nessie = {
    getAccount: async (id: string) => ({ balance: id === "ferry" ? 1000 : 0 }),
    listWithdrawals: async (id: string) => (id === "ferry" ? withdrawals : []),
    listDeposits: async (id: string) => (id === "developer" ? deposits : []),
    createWithdrawal: async (id: string, txn: NewTxn) => {
      assert.equal(id, "ferry")
      withdrawals.push({ ...txn, _id: "withdrawal-1", status: "completed" })
    },
    createDeposit: async (id: string, txn: NewTxn) => {
      assert.equal(id, "developer")
      deposits.push({ ...txn, _id: "deposit-1", status: "completed" })
    },
  } as unknown as NessieClient
  const movement: Movement = {
    ref: "payout-1",
    fromAccountId: "ferry",
    toAccountId: "developer",
    amountCents: 950,
    withdrawal: { status: "PENDING" },
    deposit: { status: "PENDING" },
  }
  return { nessie, movement, withdrawals, deposits }
}

test("withdraws the net share once, leaving the fee in Ferry", async () => {
  const { nessie, movement, withdrawals, deposits } = fixture()
  await settleTransfer(nessie, movement)
  await settleTransfer(nessie, movement)
  assert.equal(withdrawals.length, 1)
  assert.equal(deposits.length, 1)
  assert.equal(await balanceCents(nessie, "ferry"), 50)
  assert.equal(await balanceCents(nessie, "developer"), 950)
  assert.equal(movement.withdrawal.nessieId, "withdrawal-1")
  assert.equal(movement.deposit.nessieId, "deposit-1")
})

test("resumes a failed deposit without debiting Ferry again", async () => {
  const { nessie, movement, withdrawals, deposits } = fixture()
  const create = nessie.createDeposit
  nessie.createDeposit = async () => {
    throw new Error("Unavailable")
  }
  await assert.rejects(settleTransfer(nessie, movement), /Unavailable/)
  assert.equal(movement.withdrawal.status, "COMPLETED")
  nessie.createDeposit = create
  await settleTransfer(nessie, movement)
  assert.equal(withdrawals.length, 1)
  assert.equal(deposits.length, 1)
})

test("recovers an accepted deposit after a lost response", async () => {
  const { nessie, movement, withdrawals, deposits } = fixture()
  const create = nessie.createDeposit
  nessie.createDeposit = async (...args) => {
    await create(...args)
    throw new Error("Timed out")
  }
  await assert.rejects(settleTransfer(nessie, movement), /Timed out/)
  await settleTransfer(nessie, movement)
  assert.equal(withdrawals.length, 1)
  assert.equal(deposits.length, 1)
})

test("rejects invalid amounts and insufficient funds before moving money", async () => {
  const { nessie, movement, withdrawals, deposits } = fixture()
  for (const amountCents of [0, -1, 1.5, 1001]) {
    await assert.rejects(settleTransfer(nessie, { ...movement, amountCents }))
  }
  await assert.rejects(
    settleTransfer(nessie, { ...movement, toAccountId: "ferry" })
  )
  assert.equal(withdrawals.length, 0)
  assert.equal(deposits.length, 0)
})

test("does not credit the developer until the debit amount and status match", async () => {
  for (const txn of [
    { amount: 949, status: "completed" },
    { amount: 950, status: "pending" },
  ]) {
    const { nessie, movement, withdrawals, deposits } = fixture()
    withdrawals.push({
      ...txn,
      _id: "withdrawal-1",
      description: "payout-1 App withdrawal",
    })
    await assert.rejects(
      settleTransfer(nessie, movement),
      /awaiting confirmation/
    )
    assert.equal(deposits.length, 0)
  }
})
