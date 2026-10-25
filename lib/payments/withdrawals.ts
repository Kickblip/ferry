import { randomUUID } from "node:crypto"
import { and, asc, eq, sql } from "drizzle-orm"
import { apps, payments, payouts } from "@/lib/schema"
import { ApiError } from "@/lib/payments/errors"
import { settleTransfer } from "@/lib/payments/ledger"
import type { Db, Services } from "@/lib/payments/services"

export async function getWithdrawalSummary(db: Db, appId: string) {
  const [[balance], [pending]] = await Promise.all([
    db
      .select({
        availableCents: sql`greatest(0,
        coalesce((select sum(${payments.netCents}) from ${payments}
          where ${payments.appId} = ${appId} and ${payments.status} = 'SUCCEEDED'
          and (${payments.settledAt} is not null or ${payments.charge}->'deposit'->>'status' = 'COMPLETED')), 0)
        - coalesce((select sum(${payouts.amountCents}) from ${payouts}
          where ${payouts.appId} = ${appId}), 0)
      )`.mapWith(Number),
      })
      .from(apps)
      .where(eq(apps.id, appId)),
    db
      .select()
      .from(payouts)
      .where(and(eq(payouts.appId, appId), eq(payouts.status, "PENDING")))
      .orderBy(asc(payouts.createdAt), asc(payouts.id))
      .limit(1),
  ])
  return { availableCents: balance?.availableCents ?? 0, pending }
}

export async function withdrawAppBalance(
  svc: Services,
  appId: string,
  ownerId: string
) {
  // Reserve earnings before contacting Nessie so a timeout can reuse the same payout ID.
  const payout = await svc.db.transaction(async (tx) => {
    const [app] = await tx
      .select()
      .from(apps)
      .where(and(eq(apps.id, appId), eq(apps.ownerId, ownerId)))
      .for("update")
    if (!app) throw new ApiError(404, "app_not_found", "App not found")
    const { availableCents, pending } = await getWithdrawalSummary(tx, app.id)
    if (pending) return pending
    if (!svc.config.platformAccountId || !app.nessieAccountId) {
      throw new ApiError(
        409,
        "payments_not_configured",
        "Run payments:setup to prepare your Nessie accounts"
      )
    }
    if (availableCents <= 0)
      throw new ApiError(
        409,
        "empty_balance",
        "No balance available to withdraw"
      )
    if (!Number.isSafeInteger(availableCents) || availableCents > 2147483647) {
      throw new ApiError(
        409,
        "balance_too_large",
        "Balance exceeds the withdrawal limit"
      )
    }
    const id = randomUUID()
    const [created] = await tx
      .insert(payouts)
      .values({
        id,
        appId: app.id,
        amountCents: availableCents,
        transfer: {
          ref: id,
          fromAccountId: svc.config.platformAccountId,
          toAccountId: app.nessieAccountId,
          amountCents: availableCents,
          withdrawal: { status: "PENDING" },
          deposit: { status: "PENDING" },
        },
      })
      .returning()
    return created
  })

  return svc.db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(payouts)
      .where(eq(payouts.id, payout.id))
      .for("update")
    if (current.status === "PAID") return current
    let lastError: string | null = null
    try {
      await settleTransfer(svc.nessie, current.transfer)
    } catch (error) {
      lastError =
        (error instanceof Error && error.message) || "Withdrawal failed"
    }
    const [updated] = await tx
      .update(payouts)
      .set({
        transfer: current.transfer,
        status: lastError ? "PENDING" : "PAID",
        lastError,
        updatedAt: svc.now(),
        paidAt: lastError ? null : svc.now(),
      })
      .where(eq(payouts.id, current.id))
      .returning()
    return updated
  })
}
