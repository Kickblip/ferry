import { randomBytes } from "node:crypto"
import { auth } from "@clerk/nextjs/server"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { apps } from "@/lib/schema"
import { validateWebhookUrl } from "@/lib/payments/webhook-http"

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ appId: string }> }
) {
  const { userId } = await auth()
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { appId } = await params
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      appId
    )
  ) {
    return Response.json({ error: "Invalid app ID" }, { status: 400 })
  }
  const body = await request.json().catch(() => null)
  let url: string
  try {
    url = validateWebhookUrl(body?.url)
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Invalid callback URL",
      },
      { status: 400 }
    )
  }
  try {
    const [app] = await db
      .update(apps)
      .set({
        webhookUrl: url,
        // Keep the existing key, including when two saves arrive together.
        webhookSecret: sql`coalesce(${apps.webhookSecret}, ${`whsec_${randomBytes(32).toString("base64url")}`})`,
      })
      .where(and(eq(apps.id, appId), eq(apps.ownerId, userId)))
      .returning({ url: apps.webhookUrl, signingKey: apps.webhookSecret })
    if (!app) {
      return Response.json({ error: "App not found" }, { status: 404 })
    }
    return Response.json(app, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Failed to save webhook settings", error)
    return Response.json(
      { error: "Failed to save webhook settings" },
      { status: 500 }
    )
  }
}
