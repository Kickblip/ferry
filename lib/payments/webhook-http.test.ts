import assert from "node:assert/strict"
import dns from "node:dns"
import { EventEmitter } from "node:events"
import https from "node:https"
import type { IncomingMessage } from "node:http"
import test from "node:test"
import { postWebhook, validateWebhookUrl } from "./webhook-http"

test("callback URLs require public HTTPS and reject local or embedded credentials", () => {
  assert.equal(
    validateWebhookUrl("  https://hooks.example.com/payment  "),
    "https://hooks.example.com/payment"
  )
  for (const value of [
    null,
    "",
    "not a URL",
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/#fragment",
    "https://example.com/#",
    "https://localhost",
    "https://localhost.",
    "https://service.local",
    "https://127.1",
    "https://0x7f000001",
    "https://10.0.0.1",
    "https://169.254.169.254",
    "https://192.168.1.1",
    "https://100.64.0.1",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://[fc00::1]",
    "https://[fe80::1]",
    "https://[2002:7f00:1::]",
    "https://[2001:db8::1]",
    `https://example.com/${"x".repeat(2048)}`,
  ])
    assert.throws(() => validateWebhookUrl(value), /public HTTPS/)
})

test("delivery pins public DNS, signs the POST, ignores redirects, and rejects private DNS", async (t) => {
  let addresses = [{ address: "1.1.1.1", family: 4 }]
  t.mock.method(dns, "lookup", (...args: unknown[]) => {
    const callback = args[2] as (
      error: null,
      addresses: dns.LookupAddress[]
    ) => void
    callback(null, addresses)
  })
  const body = '{"name":"Ferry ⛴"}'
  let requests = 0
  let destroyed = false
  t.mock.method(https, "request", (...args: unknown[]) => {
    requests++
    const [url, options, respond] = args as [
      string,
      https.RequestOptions,
      (response: IncomingMessage) => void,
    ]
    assert.equal(url, "https://hooks.example.com/payment")
    assert.equal(options.agent, false)
    assert.equal(options.method, "POST")
    assert(options.signal instanceof AbortSignal)
    assert.deepEqual(options.headers, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "X-Ferry-Signature": "t=123,v1=signature",
    })
    const request = Object.assign(new EventEmitter(), {
      end(sent: string) {
        assert.equal(sent, body)
        options.lookup!("hooks.example.com", { all: true }, (error, pinned) => {
          if (error) {
            request.emit("error", error)
            return
          }
          assert.deepEqual(pinned, [{ address: "1.1.1.1", family: 4 }])
          respond({
            statusCode: 302,
            destroy() {
              destroyed = true
            },
          } as IncomingMessage)
        })
      },
    })
    return request
  })
  assert.equal(
    await postWebhook(
      "https://hooks.example.com/payment",
      body,
      "t=123,v1=signature"
    ),
    302
  )
  assert(destroyed)
  assert.equal(requests, 1)
  addresses = [{ address: "127.0.0.1", family: 4 }]
  await assert.rejects(
    postWebhook(
      "https://hooks.example.com/payment",
      body,
      "t=123,v1=signature"
    ),
    /failed or timed out/
  )
})
