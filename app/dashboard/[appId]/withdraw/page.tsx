import { auth } from "@clerk/nextjs/server"
import { and, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { ArrowRight, Landmark } from "lucide-react"
import { Fragment } from "react"
import { db } from "@/lib/db"
import { apps } from "@/lib/schema"
import { getServices } from "@/lib/payments/services"
import { balanceCents } from "@/lib/payments/ledger"
import { getWithdrawalSummary } from "@/lib/payments/withdrawals"
import { WithdrawButton } from "./withdraw-button"

export default async function Page({
  params,
}: {
  params: Promise<{ appId: string }>
}) {
  const { userId } = await auth.protect()
  const { appId } = await params
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      appId
    )
  )
    notFound()
  const [app] = await db
    .select()
    .from(apps)
    .where(and(eq(apps.id, appId), eq(apps.ownerId, userId)))
  if (!app) notFound()

  const svc = await getServices()
  const configured = Boolean(
    svc.config.platformAccountId && app.nessieAccountId
  )
  const [{ availableCents, pending }, bankBalances] = await Promise.all([
    getWithdrawalSummary(db, app.id),
    configured
      ? Promise.all([
          balanceCents(svc.nessie, svc.config.platformAccountId),
          balanceCents(svc.nessie, app.nessieAccountId!),
        ]).catch(() => null)
      : null,
  ])
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100)
  const accounts = [
    {
      label: "Ferry account",
      detail: "From · Shared platform account",
      id: svc.config.platformAccountId,
      balance: bankBalances?.[0],
    },
    {
      label: "Your account",
      detail: `To · ${app.name}`,
      id: app.nessieAccountId,
      balance: bankBalances?.[1],
    },
  ]

  return (
    <div className="mx-auto mt-8 flex w-full max-w-5xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl">Withdraw</h1>
        <p className="text-sm text-muted-foreground">
          Send your app’s earnings from Ferry to your simulated Nessie account.
        </p>
      </div>

      <section
        className="overflow-hidden rounded-md border"
        aria-label="Available balance"
      >
        <div className="flex flex-col gap-2 p-6">
          <p className="text-sm text-muted-foreground">Available balance</p>
          <p className="text-4xl font-semibold tabular-nums">
            {money(availableCents)}
          </p>
          <p className="text-sm text-muted-foreground">
            Settled revenue after Ferry’s fee and previous withdrawals.
          </p>
          {pending && (
            <p className="text-sm">
              {money(pending.amountCents)} is reserved for a pending withdrawal.
            </p>
          )}
        </div>
        <div className="border-t bg-secondary p-4">
          <WithdrawButton
            appId={app.id}
            disabled={!configured || (!pending && availableCents <= 0)}
            retry={Boolean(pending)}
          />
        </div>
      </section>

      <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
        {accounts.map((account, index) => (
          <Fragment key={account.label}>
            {index === 1 && (
              <ArrowRight
                className="mx-auto size-5 rotate-90 text-muted-foreground md:rotate-0"
                aria-hidden="true"
              />
            )}
            <section
              className="min-w-0 rounded-md border p-5"
              aria-label={account.label}
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-md border bg-secondary p-2">
                  <Landmark className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-medium">{account.label}</h2>
                  <p className="truncate text-xs text-muted-foreground">
                    {account.detail}
                  </p>
                </div>
              </div>
              <p className="text-2xl font-semibold tabular-nums">
                {account.balance === undefined ? "—" : money(account.balance)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Simulated bank balance
              </p>
              <p className="mt-4 text-xs text-muted-foreground">Account ID</p>
              <code className="text-xs break-all">
                {account.id || "Not configured"}
              </code>
            </section>
          </Fragment>
        ))}
      </div>
      {!configured && (
        <p className="text-sm text-muted-foreground">
          Run <code>npm run payments:setup</code> to prepare your Nessie
          accounts.
        </p>
      )}
      {configured && !bankBalances && (
        <p role="status" className="text-sm text-muted-foreground">
          Nessie balances are temporarily unavailable. Refresh to try again.
        </p>
      )}
    </div>
  )
}
