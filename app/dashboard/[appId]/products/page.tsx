import { auth } from "@clerk/nextjs/server"
import { and, asc, eq } from "drizzle-orm"
import { notFound } from "next/navigation"
import Link from "next/link"
import { CreateNewProductForm } from "./create-new-product-form"
import { db } from "@/lib/db"
import { apps, products } from "@/lib/schema"

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
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.id, appId), eq(apps.ownerId, userId)))
  if (!app) notFound()

  const appProducts = await db
    .select({ id: products.id, name: products.name, price: products.price })
    .from(products)
    .where(eq(products.appId, app.id))
    .orderBy(asc(products.name))
  const formatPrice = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  })

  return (
    <div className="mx-auto mt-8 flex w-full max-w-5xl flex-col gap-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row">
        <div className="flex max-w-lg flex-col gap-1">
          <h1 className="text-xl">Your Products</h1>
          <p className="text-sm text-muted-foreground">
            Manage the products available for purchase through this application.
          </p>
        </div>

        <CreateNewProductForm />
      </div>

      {appProducts.length === 0 ? (
        <div className="grid min-h-32 place-items-center rounded-md border p-4">
          <p className="text-sm text-muted-foreground">
            No products yet. Create your first product to get started.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {appProducts.map((product) => (
            <li key={product.id} className="min-w-0">
              <Link
                href={`/dashboard/${app.id}/products/${product.id}`}
                className="flex h-full flex-col gap-4 rounded-md border p-4 transition-colors hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <div className="flex flex-col gap-1">
                  <h2 className="font-medium break-words">{product.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {formatPrice.format(product.price / 100)}
                  </p>
                </div>
                <div className="mt-auto flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">
                    Product ID
                  </span>
                  <code className="text-xs break-all">{product.id}</code>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
