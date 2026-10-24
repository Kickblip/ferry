import { defineRelations } from "drizzle-orm"
import { drizzle } from "drizzle-orm/neon-serverless"
import { Pool } from "@neondatabase/serverless"
import * as schema from "@/lib/schema"

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
})

export const db = drizzle({
  client: pool,
  relations: defineRelations(schema),
})
