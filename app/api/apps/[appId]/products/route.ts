import { auth } from "@clerk/nextjs/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { apps, products } from "@/lib/schema"

export async function POST(
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
  const name = typeof body?.name === "string" ? body.name.trim() : ""

  if (!name) {
    return Response.json({ error: "Product name is required" }, { status: 400 })
  }

  try {
    const [app] = await db
      .select({ id: apps.id })
      .from(apps)
      .where(and(eq(apps.id, appId), eq(apps.ownerId, userId)))

    if (!app) {
      return Response.json({ error: "App not found" }, { status: 404 })
    }

    const [product] = await db
      .insert(products)
      .values({ appId: app.id, name, price: 1000 })
      .returning()

    return Response.json(product, { status: 201 })
  } catch (error) {
    console.error("Failed to create product", error)
    return Response.json({ error: "Failed to create product" }, { status: 500 })
  }
}
