import { auth } from "@clerk/nextjs/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { apps, products } from "@/lib/schema"
import { productPriceCents } from "@/lib/products"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ appId: string; productId: string }> }
) {
  const { userId } = await auth()
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { appId, productId } = await params
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuid.test(appId) || !uuid.test(productId)) {
    return Response.json(
      { error: "Invalid app or product ID" },
      { status: 400 }
    )
  }
  const body = await request.json().catch(() => null)
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  if (!name) {
    return Response.json({ error: "Product name is required" }, { status: 400 })
  }
  const price = productPriceCents(body?.price)
  if (price === null) {
    return Response.json(
      {
        error:
          "Enter a price from $0.01 to $21,474,836.47 with at most two decimal places",
      },
      { status: 400 }
    )
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
      .update(products)
      .set({ name, price })
      .where(and(eq(products.id, productId), eq(products.appId, app.id)))
      .returning()
    if (!product) {
      return Response.json({ error: "Product not found" }, { status: 404 })
    }
    return Response.json(product)
  } catch (error) {
    console.error("Failed to update product", error)
    return Response.json({ error: "Failed to update product" }, { status: 500 })
  }
}
