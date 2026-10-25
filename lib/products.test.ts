import assert from "node:assert/strict"
import test from "node:test"
import { productPriceCents } from "./products"

test("product prices convert dollars to cents without floating-point rounding", () => {
  assert.equal(productPriceCents("10"), 1000)
  assert.equal(productPriceCents(" 10.50 "), 1050)
  assert.equal(productPriceCents("1.01"), 101)
  assert.equal(productPriceCents(".01"), 1)
  assert.equal(productPriceCents("21474836.47"), 2147483647)
})

test("invalid or out-of-range prices cannot be saved", () => {
  for (const value of [
    null,
    10,
    "",
    "0",
    "-1",
    "1.001",
    "1e3",
    "Infinity",
    "1,00",
    "21474836.48",
  ]) {
    assert.equal(productPriceCents(value), null)
  }
})
