import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"
import { asc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { apps } from "@/lib/schema"

export default async function Page() {
  const { userId } = await auth.protect()

  const [app] = await db
    .select({ id: apps.id })
    .from(apps)
    .where(eq(apps.ownerId, userId))
    .orderBy(asc(apps.createdAt), asc(apps.id))
    .limit(1)

  if (app) redirect(`/dashboard/${app.id}`)

  redirect("/dashboard/new")
}
