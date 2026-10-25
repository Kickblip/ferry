import { auth } from "@clerk/nextjs/server"
import { and, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { apps } from "@/lib/schema"
import { redirect } from "next/navigation"
import Image from "next/image"
import { ImageIcon } from "lucide-react"
import { getAppDashboard } from "@/lib/payments/queries"
import { Button } from "@/components/ui/button"

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
    redirect("/dashboard/new")
  }

  const [app] = await db
    .select({ id: apps.id, name: apps.name })
    .from(apps)
    .where(and(eq(apps.id, appId), eq(apps.ownerId, userId)))
    .limit(1)

  if (!app) redirect("/dashboard/new")

  const { transactions, stats } = await getAppDashboard(db, app.id)
  const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  })
  const money = (cents: number) => currency.format(cents / 100)
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const cards = [
    {
      label: "Total revenue",
      value: money(stats.revenueCents),
      detail: "All time, after platform fees",
    },
    {
      label: "Last 30 days",
      value: money(stats.recentRevenueCents),
      detail: "Revenue after platform fees",
    },
    {
      label: "Successful sales",
      value: stats.sales.toLocaleString("en-US"),
      detail: "All completed checkouts",
    },
    {
      label: "Average sale",
      value: money(stats.averageRevenueCents),
      detail: "Average revenue after platform fees",
    },
  ]

  return (
    <div className="mx-auto mt-8 flex w-full max-w-5xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl">{app.name}</h1>
        <p className="text-sm text-muted-foreground">
          Your simulated checkout revenue after Ferry’s platform fee.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <section
          className="min-w-0 overflow-hidden rounded-md border lg:col-span-2"
          aria-labelledby="recent-transactions"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="border-b bg-secondary text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-normal">
                    Product
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-normal">
                    Revenue
                  </th>
                  <th scope="col" className="px-4 py-2 font-normal">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="p-8 text-center text-muted-foreground"
                    >
                      No transactions yet. Successful checkouts will appear
                      here.
                    </td>
                  </tr>
                ) : (
                  transactions.map((transaction) => (
                    <tr
                      key={transaction.id}
                      className="border-b last:border-b-0"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border bg-secondary">
                            {transaction.imageUrl ? (
                              <Image
                                src={transaction.imageUrl}
                                alt=""
                                fill
                                sizes="40px"
                                className="object-cover"
                              />
                            ) : (
                              <ImageIcon
                                className="size-4 text-muted-foreground"
                                aria-hidden="true"
                              />
                            )}
                          </div>
                          <span
                            className="max-w-48 truncate"
                            title={transaction.productName}
                          >
                            {transaction.productName}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                        {money(transaction.revenueCents)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        <time dateTime={transaction.date.toISOString()}>
                          {date.format(transaction.date)}
                        </time>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="min-h-16" />
        </section>

        <aside aria-label="Revenue statistics">
          <dl className="flex flex-col gap-4">
            {cards.map((card) => (
              <div key={card.label} className="rounded-md border p-4">
                <dt className="text-sm text-muted-foreground">{card.label}</dt>
                <dd className="mt-2 text-2xl font-semibold tabular-nums">
                  {card.value}
                </dd>
                <dd className="mt-1 text-xs text-muted-foreground">
                  {card.detail}
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </div>
  )
}
