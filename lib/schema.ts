import { sql } from "drizzle-orm"
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import type { Movement } from "@/lib/payments/types"

export const paymentStatusEnum = pgEnum("payment_status", [
  "REQUIRES_CONFIRMATION",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "EXPIRED",
])
export const payoutStatusEnum = pgEnum("payout_status", ["PENDING", "PAID"])
export const currencyEnum = pgEnum("currency", ["USD"])
export const paymentFailureCodeEnum = pgEnum("payment_failure_code", [
  "INSUFFICIENT_FUNDS",
  "NESSIE_REJECTED",
  // Kept so existing failures survive the enum migration.
  "NESSIE_UNAVAILABLE",
  "AMOUNT_NOT_WHOLE_DOLLARS",
])

export const apps = pgTable("apps", {
  id: uuid().defaultRandom().primaryKey(),
  ownerId: text().notNull(),
  name: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  /** Prepared when the app is created or by payments:setup. */
  nessieAccountId: text(),
})

export const products = pgTable("products", {
  id: uuid().defaultRandom().primaryKey(),
  appId: uuid()
    .notNull()
    .references(() => apps.id, { onDelete: "restrict" }),
  name: text().notNull(),
  price: integer().notNull(),
})

/**
 * Secret API keys a game's server uses to call the payments API. Only a
 * SHA-256 hash is stored; see lib/payments/api-keys.ts for the format.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid().defaultRandom().primaryKey(),
    appId: uuid()
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    /** First characters of the key, safe to show in the dashboard. */
    prefix: text().notNull(),
    hash: text().notNull(),
    label: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex().on(t.hash), index().on(t.appId)]
)

/** Pre-made Nessie accounts players can pay from on the checkout page. */
export const payerAccounts = pgTable("payer_accounts", {
  nessieAccountId: text().primaryKey(),
  label: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

export const payments = pgTable(
  "payments",
  {
    id: uuid().defaultRandom().primaryKey(),
    appId: uuid()
      .notNull()
      .references(() => apps.id, { onDelete: "restrict" }),
    productId: uuid().references(() => products.id, {
      onDelete: "set null",
    }),
    /** The game's own order id; one active payment per app + order. */
    orderId: text().notNull(),
    playerId: text().notNull(),
    description: text().notNull(),
    amountCents: integer().notNull(),
    currency: currencyEnum().notNull().default("USD"),
    feeCents: integer().notNull(),
    netCents: integer().notNull(),
    status: paymentStatusEnum().notNull().default("REQUIRES_CONFIRMATION"),
    returnUrl: text(),
    metadata: jsonb().$type<Record<string, string>>(),
    payerAccountId: text(),
    /** Player → platform money movement in Nessie. */
    charge: jsonb().$type<Movement>(),
    failureCode: paymentFailureCodeEnum(),
    failureMessage: text(),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    confirmedAt: timestamp({ withTimezone: true }),
    succeededAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("payments_active_order_idx")
      .on(t.appId, t.orderId)
      .where(sql`${t.status} not in ('FAILED', 'CANCELED', 'EXPIRED')`),
    index().on(t.appId, t.createdAt),
    index().on(t.status),
  ]
)

/** The developer's share of a payment, paid platform → developer in Nessie. */
export const payouts = pgTable(
  "payouts",
  {
    id: uuid().defaultRandom().primaryKey(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    appId: uuid()
      .notNull()
      .references(() => apps.id, { onDelete: "restrict" }),
    amountCents: integer().notNull(),
    status: payoutStatusEnum().notNull().default("PENDING"),
    transfer: jsonb().$type<Movement>().notNull(),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    paidAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex().on(t.paymentId), index().on(t.appId)]
)
