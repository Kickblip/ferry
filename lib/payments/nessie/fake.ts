import crypto from "node:crypto"
import { NessieError } from "@/lib/payments/errors"
import type {
  NessieAccount,
  NessieClient,
  NessieTxn,
  NewAccount,
  NewCustomer,
  NewTxn,
} from "@/lib/payments/nessie/client"

type Op = keyof NessieClient
type Fault = "error" | "reject" | "timeout-after-write"

/**
 * In-memory Nessie that behaves like the real one where it matters: create calls return no ids,
 * stored balances never change, and amounts are whole numbers. Tests can inject faults:
 *   - "error": the call fails before doing anything (retryable, like a network blip or 5xx)
 *   - "reject": the call fails with a non-retryable 400
 *   - "timeout-after-write": the write happens, then the call fails — the classic double-charge trap
 */
export class FakeNessie implements NessieClient {
  accounts = new Map<string, NessieAccount>()
  withdrawals = new Map<string, NessieTxn[]>()
  deposits = new Map<string, NessieTxn[]>()
  private customers: { _id: string; first_name: string; last_name: string }[] =
    []
  private faults: { op: Op; fault: Fault }[] = []
  calls: { op: Op; accountId?: string; description?: string }[] = []

  /** Queue a fault for the next call to `op` (faults are consumed in order). */
  failNext(op: Op, fault: Fault = "error", times = 1) {
    for (let i = 0; i < times; i++) this.faults.push({ op, fault })
  }

  addAccount(
    nickname: string,
    balance: number,
    id = crypto.randomBytes(12).toString("hex")
  ): string {
    this.accounts.set(id, {
      _id: id,
      nickname,
      type: "Checking",
      balance,
      customer_id: "cust_fake",
    })
    return id
  }

  async getAccount(accountId: string) {
    this.before("getAccount", accountId)
    return structuredClone(this.account(accountId))
  }

  async listWithdrawals(accountId: string) {
    this.before("listWithdrawals", accountId)
    this.account(accountId)
    return structuredClone(this.withdrawals.get(accountId) ?? [])
  }

  async listDeposits(accountId: string) {
    this.before("listDeposits", accountId)
    this.account(accountId)
    return structuredClone(this.deposits.get(accountId) ?? [])
  }

  async createWithdrawal(accountId: string, txn: NewTxn) {
    const fault = this.before("createWithdrawal", accountId, txn.description)
    this.record(this.withdrawals, accountId, txn)
    if (fault === "timeout-after-write")
      throw new NessieError("timeout after write", null, true)
  }

  async createDeposit(accountId: string, txn: NewTxn) {
    const fault = this.before("createDeposit", accountId, txn.description)
    this.record(this.deposits, accountId, txn)
    if (fault === "timeout-after-write")
      throw new NessieError("timeout after write", null, true)
  }

  async createCustomer(customer: NewCustomer) {
    this.before("createCustomer")
    const id = crypto.randomBytes(12).toString("hex")
    this.customers.push({ _id: id, ...customer })
    return id
  }

  async createAccount(_customerId: string, account: NewAccount) {
    this.before("createAccount")
    return this.addAccount(account.nickname, account.balance)
  }

  private record(
    map: Map<string, NessieTxn[]>,
    accountId: string,
    txn: NewTxn
  ) {
    this.account(accountId)
    if (!Number.isInteger(txn.amount))
      throw new NessieError("amount must be an integer", 400, false)
    const list = map.get(accountId) ?? []
    list.push({
      _id: crypto.randomBytes(12).toString("hex"),
      amount: txn.amount,
      description: txn.description,
      status: "completed",
      medium: "balance",
    })
    map.set(accountId, list)
  }

  private account(accountId: string) {
    const account = this.accounts.get(accountId)
    if (!account)
      throw new NessieError(`Account ${accountId} not found`, 404, false)
    return account
  }

  private before(
    op: Op,
    accountId?: string,
    description?: string
  ): Fault | undefined {
    this.calls.push({ op, accountId, description })
    const i = this.faults.findIndex((f) => f.op === op)
    if (i === -1) return undefined
    const [{ fault }] = this.faults.splice(i, 1)
    if (fault === "error")
      throw new NessieError(`injected ${op} failure`, 503, true)
    if (fault === "reject")
      throw new NessieError(`injected ${op} rejection`, 400, false)
    return fault
  }
}
