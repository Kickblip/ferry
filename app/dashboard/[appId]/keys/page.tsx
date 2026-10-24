import { auth } from "@clerk/nextjs/server"
import { and, desc, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { apps, apiKeys } from "@/lib/schema"
import { CreateNewKeyForm } from "./create-new-key-form"

export default async function Page({
  params,
}: {
  params: Promise<{ appId: string }>
}) {
  const { userId } = await auth.protect()
  const { appId } = await params

  const [app] = await db
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.id, appId), eq(apps.ownerId, userId)))

  if (!app) notFound()

  const appKeys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.prefix,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.appId, app.id))
    .orderBy(desc(apiKeys.createdAt))

  return (
    <div className="mx-auto mt-8 flex w-full max-w-5xl flex-col gap-8">
      <div className="flex justify-between">
        <div className="flex max-w-lg flex-col gap-1">
          <h1 className="text-xl">Your API Keys</h1>
          <p className="text-sm text-muted-foreground">
            API keys authenticate requests to Ferry for this application. Keep
            them secret and use them only in server-side code.
          </p>
        </div>

        <CreateNewKeyForm />
      </div>

      <div className="rounded-md border">
        <div className="grid grid-cols-3 gap-4 rounded-t-md border-b bg-secondary px-4 py-2">
          <span className="text-sm text-muted-foreground">Name</span>
          <span className="text-sm text-muted-foreground">API Key</span>
          <span className="text-sm text-muted-foreground">Created</span>
        </div>

        {appKeys.length === 0 ? (
          <div className="grid place-items-center p-4">
            <p className="text-sm text-muted-foreground">No API keys yet</p>
          </div>
        ) : (
          appKeys.map((key) => (
            <div
              key={key.id}
              className="grid grid-cols-3 gap-4 border-b px-4 py-3 text-sm last:border-b-0"
            >
              <span className="truncate">{key.name}</span>
              <code className="truncate">
                {key.keyPrefix ? `${key.keyPrefix}••••••••` : "Hidden"}
              </code>
              <time dateTime={key.createdAt.toISOString()}>
                {key.createdAt.toLocaleDateString("en-US", {
                  timeZone: "America/Chicago",
                })}
              </time>
            </div>
          ))
        )}

        <div className="min-h-32"></div>
      </div>
    </div>
  )
}
