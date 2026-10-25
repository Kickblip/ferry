import assert from "node:assert/strict"
import test from "node:test"
import { paymentWebhookBody, signWebhook } from "./webhooks"
import type { Payment } from "./views"

test("signatures cover the timestamp and exact request body", () => {
  const body = '{"id":"event-1"}'
  const signature = signWebhook(body, "whsec_test_secret", 1700000000)
  assert.equal(
    signature,
    "t=1700000000,v1=c9868fa80b7a9491c6b300d15d01f7e8325c2999032c26e9fc3ce2e4ea29dd36"
  )
  assert.notEqual(
    signWebhook(`${body}\n`, "whsec_test_secret", 1700000000),
    signature
  )
  assert.notEqual(signWebhook(body, "whsec_test_secret", 1700000001), signature)
  assert.notEqual(signWebhook(body, "different-secret", 1700000000), signature)
})

test("payment events include fulfillment details without bank or internal fields", () => {
  const now = new Date("2026-10-25T12:00:00.000Z")
  const payment: Payment = {
    id: "payment-1",
    appId: "app-1",
    productId: "product-1",
    orderId: "order-1",
    playerId: "player-1",
    description: "100 gems",
    amountCents: 499,
    currency: "USD",
    feeCents: 25,
    netCents: 474,
    status: "SUCCEEDED",
    returnUrl: "game://checkout",
    metadata: { level: "1" },
    nessieDepositId: "private-deposit",
    settledAt: null,
    payerAccountId: "private-account",
    charge: null,
    failureCode: null,
    failureMessage: null,
    lastError: "private-debug-message",
    createdAt: now,
    updatedAt: now,
    expiresAt: now,
    confirmedAt: now,
    succeededAt: now,
  }
  const event = JSON.parse(paymentWebhookBody(payment, "event-1", now))
  assert.equal(event.id, "event-1")
  assert.equal(event.type, "payment.succeeded")
  assert.equal(event.createdAt, now.toISOString())
  assert.equal(event.data.orderId, "order-1")
  assert.equal(event.data.playerId, "player-1")
  assert.equal(event.data.productId, "product-1")
  assert.equal(event.data.amountCents, 499)
  assert.equal(event.data.status, "SUCCEEDED")
  assert.equal(event.data.simulated, true)
  assert.equal(event.data.settledAt, null)
  for (const field of [
    "nessieDepositId",
    "payerAccountId",
    "charge",
    "lastError",
    "returnUrl",
  ]) {
    assert.equal(field in event.data, false)
  }
})
