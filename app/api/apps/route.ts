import { auth } from "@clerk/nextjs/server"
import { db } from "@/lib/db"
import { apps } from "@/lib/schema"

export async function POST(request: Request) {
  const { userId } = await auth()

  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const name = typeof body?.name === "string" ? body.name.trim() : ""

  if (!name) {
    return Response.json({ error: "App name is required" }, { status: 400 })
  }

  try {
    const [app] = await db
      .insert(apps)
      .values({ name, ownerId: userId })
      .returning()

    return Response.json(app, { status: 201 })
  } catch (error) {
    console.error("Failed to create app", error)
    return Response.json({ error: "Failed to create app" }, { status: 500 })
  }
}
