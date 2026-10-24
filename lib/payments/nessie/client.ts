import { NessieError } from "@/lib/payments/errors"

/** A deposit or withdrawal as Nessie returns it. Amounts are Nessie's whole numbers (see NESSIE_AMOUNT_UNIT). */
export interface NessieTxn {
  _id: string
  amount: number
  description: string
  status: string
  medium?: string
  transaction_date?: string
}

export interface NessieAccount {
  _id: string
  nickname: string
  type: string
  /** Opening balance. Nessie never updates it; real balances are computed from deposits and withdrawals. */
  balance: number
  customer_id: string
}

export interface NewTxn {
  amount: number
  description: string
}

export interface NewCustomer {
  first_name: string
  last_name: string
}

export interface NewAccount {
  nickname: string
  /** Opening balance (Nessie's whole-number units). */
  balance: number
}

/**
 * The parts of Nessie this service uses. Nessie (as of Oct 2026, per its OpenAPI spec and live tests)
 * has no account-to-account transfer endpoint, returns no ids from create calls, and never updates
 * stored balances — so money moves as withdrawal + deposit pairs that we find again by description.
 */
export interface NessieClient {
  getAccount(accountId: string): Promise<NessieAccount>
  listWithdrawals(accountId: string): Promise<NessieTxn[]>
  listDeposits(accountId: string): Promise<NessieTxn[]>
  createWithdrawal(accountId: string, txn: NewTxn): Promise<void>
  createDeposit(accountId: string, txn: NewTxn): Promise<void>
  createCustomer(customer: NewCustomer): Promise<string>
  createAccount(customerId: string, account: NewAccount): Promise<string>
}

const today = () => new Date().toISOString().slice(0, 10)
const ADDRESS = {
  street_number: "1",
  street_name: "Speedway",
  city: "Austin",
  state: "TX",
  zip: "78712",
}

export class HttpNessieClient implements NessieClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private timeoutMs = 10_000
  ) {
    if (!apiKey) throw new Error("NESSIE_API_KEY is not set")
  }

  getAccount(accountId: string) {
    return this.request<NessieAccount>("GET", `/accounts/${accountId}`)
  }

  listWithdrawals(accountId: string) {
    return this.request<NessieTxn[]>(
      "GET",
      `/accounts/${accountId}/withdrawals`
    )
  }

  listDeposits(accountId: string) {
    return this.request<NessieTxn[]>("GET", `/accounts/${accountId}/deposits`)
  }

  async createWithdrawal(accountId: string, txn: NewTxn) {
    await this.request(
      "POST",
      `/accounts/${accountId}/withdrawals`,
      this.txnBody(txn)
    )
  }

  async createDeposit(accountId: string, txn: NewTxn) {
    await this.request(
      "POST",
      `/accounts/${accountId}/deposits`,
      this.txnBody(txn)
    )
  }

  async createCustomer(customer: NewCustomer) {
    const created = await this.request<unknown>("POST", "/customers", {
      ...customer,
      address: ADDRESS,
    })
    const id = createdId(created)
    if (id) return id
    // Nessie answers "Customer created" without an id: find it by its (caller-made unique) name.
    const all = await this.request<
      { _id: string; first_name: string; last_name: string }[]
    >("GET", "/customers")
    const match = all.find(
      (c) =>
        c.first_name === customer.first_name &&
        c.last_name === customer.last_name
    )
    if (!match) throw new NessieError("Created customer not found", null, true)
    return match._id
  }

  async createAccount(customerId: string, account: NewAccount) {
    const created = await this.request<unknown>(
      "POST",
      `/customers/${customerId}/accounts`,
      {
        type: "Checking",
        nickname: account.nickname,
        rewards: 0,
        balance: account.balance,
      }
    )
    const id = createdId(created)
    if (id) return id
    const all = await this.request<NessieAccount[]>(
      "GET",
      `/customers/${customerId}/accounts`
    )
    const match = all.find((a) => a.nickname === account.nickname)
    if (!match) throw new NessieError("Created account not found", null, true)
    return match._id
  }

  private txnBody(txn: NewTxn) {
    return {
      medium: "balance",
      transaction_date: today(),
      status: "completed",
      amount: txn.amount,
      description: txn.description,
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}?key=${encodeURIComponent(this.apiKey)}`
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      throw new NessieError(
        `Nessie ${method} ${path} failed: ${(err as Error).message}`,
        null,
        true
      )
    }
    const text = await res.text()
    if (!res.ok) {
      throw new NessieError(
        `Nessie ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`,
        res.status,
        res.status >= 500 || res.status === 429
      )
    }
    try {
      return JSON.parse(text) as T
    } catch {
      return text as T
    }
  }
}

/** Some Nessie deployments return the created object; most return only a message. */
function createdId(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined
  const r = response as { _id?: string; objectCreated?: { _id?: string } }
  return r.objectCreated?._id ?? r._id
}
