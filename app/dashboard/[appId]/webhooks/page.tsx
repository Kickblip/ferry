import { auth } from "@clerk/nextjs/server"
import { and, desc, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import { db } from "@/lib/db"
import { apps, webhookDeliveries } from "@/lib/schema"
import { WebhookSettingsForm } from "./webhook-settings-form"

export default async function Page({
  params,
}: {
  params: Promise<{ appId: string }>
}) {
  const { userId } = await auth.protect()
  const { appId } = await params
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      appId
    )
  ) {
    notFound()
  }

  const [app] = await db
    .select({
      id: apps.id,
      webhookUrl: apps.webhookUrl,
      webhookSecret: apps.webhookSecret,
    })
    .from(apps)
    .where(and(eq(apps.id, appId), eq(apps.ownerId, userId)))

  if (!app) notFound()

  const calls = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.appId, app.id))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(50)

  return (
    <div className="mx-auto mt-8 flex w-full max-w-5xl flex-col gap-8">
      <div className="flex flex-col justify-between gap-6 md:flex-row">
        <div className="flex max-w-sm flex-col gap-1">
          <h1 className="text-xl">Your Webhooks</h1>
          <p className="text-sm text-muted-foreground">
            Receive a notification when a checkout succeeds. Add your callback
            URL and use the signing key to verify calls from Ferry.
          </p>
        </div>

        <WebhookSettingsForm
          key={app.id}
          appId={app.id}
          initialUrl={app.webhookUrl}
          initialSigningKey={app.webhookSecret}
        />
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-xl text-left text-sm">
          <caption className="sr-only">Recent webhook calls</caption>
          <thead className="border-b bg-secondary text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-normal">
                Event
              </th>
              <th scope="col" className="px-4 py-2 font-normal">
                Status
              </th>
              <th scope="col" className="px-4 py-2 font-normal">
                Response
              </th>
              <th scope="col" className="px-4 py-2 font-normal">
                Sent
              </th>
            </tr>
          </thead>
          <tbody>
            {calls.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="p-4 text-center text-muted-foreground"
                >
                  No webhook calls yet. Complete a checkout after saving your
                  URL.
                </td>
              </tr>
            ) : (
              calls.map((call) => (
                <tr key={call.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3">
                    <code>{call.eventType}</code>
                    <p
                      className="max-w-64 truncate text-xs text-muted-foreground"
                      title={call.callbackUrl}
                    >
                      {call.callbackUrl}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        call.status === "FAILED" ? "text-destructive" : ""
                      }
                    >
                      {call.status === "DELIVERED"
                        ? "Delivered"
                        : call.status === "FAILED"
                          ? "Failed"
                          : "Pending"}
                    </span>
                  </td>
                  <td className="max-w-xs px-4 py-3 break-words">
                    {call.responseStatus ? `HTTP ${call.responseStatus}` : "—"}
                    {call.error && (
                      <p className="text-xs text-muted-foreground">
                        {call.error}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <time dateTime={call.createdAt.toISOString()}>
                      {call.createdAt.toLocaleString("en-US", {
                        timeZone: "America/Chicago",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="min-h-32" />
      </div>
    </div>
  )
}
