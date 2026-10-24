import { describe, expect, it } from "vitest"
import { hashApiKey, keyPrefix } from "@/lib/payments/api-keys"
import {
  feeFor,
  splitPayment,
  toNessieAmount,
  fromNessieAmount,
} from "@/lib/payments/money"
import { signWebhook, verifyWebhook } from "@/lib/payments/webhooks"

describe("money", () => {
  it("takes a 5% fee in whole cents, rounding half up", () => {
    expect(splitPayment(499, 500)).toEqual({ feeCents: 25, netCents: 474 })
    expect(splitPayment(1000, 500)).toEqual({ feeCents: 50, netCents: 950 })
    expect(feeFor(10, 500)).toBe(1) // 0.5¢ rounds up
    expect(feeFor(9, 500)).toBe(0) // 0.45¢ rounds down
  })

  it("never loses a cent between fee and net", () => {
    for (let cents = 1; cents <= 5000; cents += 7) {
      const { feeCents, netCents } = splitPayment(cents, 500)
      expect(feeCents + netCents).toBe(cents)
    }
  })

  it("stores cents in Nessie as whole numbers, or whole dollars only in dollars mode", () => {
    expect(toNessieAmount(499, "cents")).toBe(499)
    expect(fromNessieAmount(499, "cents")).toBe(499)
    expect(toNessieAmount(1200, "dollars")).toBe(12)
    expect(() => toNessieAmount(1234, "dollars")).toThrow(/whole-dollar/)
  })
})

describe("webhook signatures", () => {
  const secret = "whsec_test"
  const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded" })
  const now = Date.parse("2026-10-25T12:00:00Z")
  const t = Math.floor(now / 1000)

  it("verifies a genuine signature", () => {
    expect(verifyWebhook(secret, signWebhook(secret, body, t), body, now)).toBe(
      true
    )
  })

  it("rejects a tampered body, a wrong secret, and a missing header", () => {
    const sig = signWebhook(secret, body, t)
    expect(
      verifyWebhook(secret, sig, body.replace("succeeded", "failed"), now)
    ).toBe(false)
    expect(verifyWebhook("whsec_other", sig, body, now)).toBe(false)
    expect(verifyWebhook(secret, null, body, now)).toBe(false)
  })

  it("rejects replays older than 5 minutes", () => {
    const old = signWebhook(secret, body, t - 301)
    expect(verifyWebhook(secret, old, body, now)).toBe(false)
  })
})

describe("api keys", () => {
  it("stores a stable hash and a short display prefix, never the key", () => {
    const key = "sk_test_abcdefghijklmnopqrstuvwxyz"
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashApiKey(key)).toBe(hashApiKey(key))
    expect(keyPrefix(key)).toBe("sk_test_abcd")
  })
})
