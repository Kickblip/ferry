import { createHash, randomBytes } from "node:crypto"
import { auth } from "@clerk/nextjs/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { apps, apiKeys } from "@/lib/schema"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ appId: string }> }
) {
  const { userId } = await auth()

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { appId } = await params
  const body = await request.json().catch(() => null)
  const name = typeof body?.name === "string" ? body.name.trim() : ""

  if (!name) {
    return Response.json({ error: "Key name is required" }, { status: 400 })
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      appId
    )
  ) {
    return Response.json({ error: "Invalid app ID" }, { status: 400 })
  }

  try {
    const [app] = await db
      .select({ id: apps.id })
      .from(apps)
      .where(and(eq(apps.id, appId), eq(apps.ownerId, userId)))

    if (!app) {
      return Response.json({ error: "App not found" }, { status: 404 })
    }

    const apiKey = `ferry-${randomBytes(32).toString("base64url")}`
    const keyHash = createHash("sha256").update(apiKey).digest("hex")

    const [created] = await db
      .insert(apiKeys)
      .values({
        appId: app.id,
        name,
        hash: keyHash,
        prefix: apiKey.slice(0, 14),
      })
      .returning({ id: apiKeys.id })

    return Response.json(
      { id: created.id, apiKey },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    console.error("Failed to create API key", error)
    return Response.json({ error: "Failed to create API key" }, { status: 500 })
  }
}
