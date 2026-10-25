import assert from "node:assert/strict"
import test from "node:test"
import { db } from "@/lib/db"
import { ourFileRouter } from "./core"

const complete = ourFileRouter.productImage.onUploadComplete
const upload = {
  metadata: { userId: "owner", appId: "app", productId: "product" },
  file: { key: "new-image", ufsUrl: "https://test.ufs.sh/f/new-image" },
}
type Transaction = Parameters<typeof db.transaction>[0]
const selection = (rows: unknown[]) => ({
  from: () => ({
    innerJoin: () => ({ where: () => ({ for: async () => rows }) }),
  }),
})

test("replacement saves the verified image before deleting the old file", async (t) => {
  const steps: string[] = []
  const previousToken = process.env.UPLOADTHING_TOKEN
  process.env.UPLOADTHING_TOKEN = Buffer.from(
    '{"apiKey":"sk_test_fake","appId":"test","regions":["sea1"]}'
  ).toString("base64")
  t.after(() => {
    if (previousToken === undefined) delete process.env.UPLOADTHING_TOKEN
    else process.env.UPLOADTHING_TOKEN = previousToken
  })
  t.mock.method(db, "transaction", async (callback: Transaction) => {
    const result = await callback({
      select: () => selection([{ id: "product", imageKey: "old-image" }]),
      update: () => ({
        set(values: unknown) {
          assert.deepEqual(values, {
            imageUrl: upload.file.ufsUrl,
            imageKey: upload.file.key,
          })
          return { where: async () => steps.push("saved") }
        },
      }),
    } as never)
    steps.push("committed")
    return result
  })
  t.mock.method(
    globalThis,
    "fetch",
    async (request: Parameters<typeof fetch>[0], options?: RequestInit) => {
      const outgoing = new Request(request, options)
      assert.match(outgoing.url, /\/v6\/deleteFiles$/)
      assert.deepEqual(await outgoing.json(), { fileKeys: ["old-image"] })
      assert.deepEqual(steps, ["saved", "committed"])
      steps.push("deleted")
      return Response.json({ success: true, deletedCount: 1 })
    }
  )
  assert.deepEqual(await complete(upload), { imageUrl: upload.file.ufsUrl })
  assert.deepEqual(steps, ["saved", "committed", "deleted"])
})

test("completion cannot update or delete images without an owned product", async (t) => {
  t.mock.method(db, "transaction", async (callback: Transaction) =>
    callback({
      select: () => selection([]),
      update: () => assert.fail("Must not update an inaccessible product"),
    } as never)
  )
  const network = t.mock.method(globalThis, "fetch", async () => {
    assert.fail("Must not delete files for an inaccessible product")
  })
  await assert.rejects(Promise.resolve(complete(upload)), /Product not found/)
  assert.equal(network.mock.callCount(), 0)
})
