import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core"

export const apps = pgTable("apps", {
  id: uuid().defaultRandom().primaryKey(),
  ownerId: text().notNull(),
  name: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

export const products = pgTable("products", {
  id: uuid().defaultRandom().primaryKey(),
  appId: uuid()
    .notNull()
    .references(() => apps.id, { onDelete: "restrict" }),
  name: text().notNull(),
  price: integer().notNull(),
})
