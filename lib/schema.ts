import { sql } from "drizzle-orm"
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import type { Movement } from "@/lib/payments/types"

export const apps = pgTable("apps", {
  id: uuid().defaultRandom().primaryKey(),
  ownerId: text().notNull(),
  name: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  // Payments: filled in automatically the first time the app takes a payment.
  /** Nessie account that receives this app's payouts. */
  nessieAccountId: text(),
  webhookUrl: text(),
  /** Signs webhooks sent to webhookUrl (HMAC-SHA256). */
  webhookSecret: text(),
  /** Overrides the platform fee for this app, in basis points (500 = 5%). */
  feeBps: integer(),
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
    name: text().notNull(),
    /** First characters of the key, safe to show in the dashboard. */
    prefix: text().notNull(),
    hash: text().notNull(),
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
    currency: text().notNull().default("usd"),
    feeCents: integer().notNull(),
    netCents: integer().notNull(),
    /** requires_confirmation | processing | succeeded | failed | canceled | expired */
    status: text().notNull(),
    returnUrl: text(),
    metadata: jsonb().$type<Record<string, string>>(),
    payerAccountId: text(),
    /** Player → platform money movement in Nessie. */
    charge: jsonb().$type<Movement>(),
    failureCode: text(),
    failureMessage: text(),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }),
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
      .where(sql`${t.status} not in ('failed', 'canceled', 'expired')`),
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
    /** pending | processing | paid */
    status: text().notNull(),
    transfer: jsonb().$type<Movement>().notNull(),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    paidAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex().on(t.paymentId), index().on(t.appId)]
)

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid().defaultRandom().primaryKey(),
    appId: uuid()
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    eventId: text().notNull(),
    /** payment.succeeded | payment.failed */
    type: text().notNull(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    payload: text().notNull(),
    /** pending | delivered | failed */
    status: text().notNull(),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }),
    responseStatus: integer(),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
    deliveredAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.appId, t.createdAt), index().on(t.status)]
)
