import crypto from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import { apiKeys, apps } from "@/lib/schema"
import { ApiError } from "@/lib/payments/errors"
import type { Db } from "@/lib/payments/services"

/**
 * API keys look like `sk_test_<random>` and are sent as
 * `Authorization: Bearer <key>` by the game's server.
 *
 * Key *generation* is the dashboard's job (built separately). This module only
 * defines how keys are stored and checked, so any generator works if it:
 *   1. makes a high-entropy key starting with "sk_" (24+ characters),
 *   2. shows it to the developer once,
 *   3. saves it with `registerApiKey(db, appId, key)`, which stores only its
 *      SHA-256 hash and a short display prefix.
 */
export const API_KEY_PREFIX = "sk_"

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex")
}

export function keyPrefix(rawKey: string): string {
  return rawKey.slice(0, 12)
}

/** Convenience generator (scripts and tests); the dashboard may use its own. */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}test_${crypto.randomBytes(24).toString("base64url")}`
}

export async function registerApiKey(
  db: Db,
  appId: string,
  rawKey: string,
  label?: string
) {
  if (!rawKey.startsWith(API_KEY_PREFIX) || rawKey.length < 24) {
    throw new ApiError(
      400,
      "invalid_api_key_format",
      `API keys must start with "${API_KEY_PREFIX}" and be at least 24 characters`
    )
  }
  const [record] = await db
    .insert(apiKeys)
    .values({
      appId,
      prefix: keyPrefix(rawKey),
      hash: hashApiKey(rawKey),
      label,
    })
    .returning({
      id: apiKeys.id,
      prefix: apiKeys.prefix,
      label: apiKeys.label,
      createdAt: apiKeys.createdAt,
    })
  return record
}

export async function revokeApiKey(db: Db, appId: string, keyId: string) {
  const revoked = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, keyId),
        eq(apiKeys.appId, appId),
        isNull(apiKeys.revokedAt)
      )
    )
    .returning({ id: apiKeys.id })
  if (!revoked.length) {
    throw new ApiError(404, "api_key_not_found", `No active API key ${keyId}`)
  }
}

export type App = typeof apps.$inferSelect

/** Resolves the app for a request's bearer key, or throws 401. */
export async function authenticateApp(db: Db, request: Request): Promise<App> {
  const raw = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!raw) {
    throw new ApiError(
      401,
      "missing_api_key",
      'Send your secret key as "Authorization: Bearer sk_..."'
    )
  }
  const [row] = await db
    .select({ app: apps })
    .from(apiKeys)
    .innerJoin(apps, eq(apps.id, apiKeys.appId))
    .where(and(eq(apiKeys.hash, hashApiKey(raw)), isNull(apiKeys.revokedAt)))
  if (!row) {
    throw new ApiError(401, "invalid_api_key", "Unknown or revoked API key")
  }
  return row.app
}
