import { auth } from "@clerk/nextjs/server"
import { and, eq } from "drizzle-orm"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Button } from "@/components/ui/button"
import { db } from "@/lib/db"
import { apps, products } from "@/lib/schema"
import { EditProductForm } from "./edit-product-form"

export default async function Page({
  params,
}: {
  params: Promise<{ appId: string; productId: string }>
}) {
  const { userId } = await auth.protect()
  const { appId, productId } = await params
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuid.test(appId) || !uuid.test(productId)) notFound()

  const [product] = await db
    .select({
      id: products.id,
      appId: products.appId,
      name: products.name,
      price: products.price,
      imageUrl: products.imageUrl,
    })
    .from(products)
    .innerJoin(apps, eq(products.appId, apps.id))
    .where(
      and(
        eq(products.id, productId),
        eq(products.appId, appId),
        eq(apps.ownerId, userId)
      )
    )
  if (!product) notFound()

  return (
    <div className="mx-auto mt-8 flex w-full max-w-5xl flex-col gap-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row">
        <div className="flex max-w-lg flex-col gap-1">
          <h1 className="text-xl">Edit Product</h1>
          <p className="text-sm text-muted-foreground">
            Update this product’s image, name, and price for future checkouts.
          </p>
        </div>
        <Button asChild variant="outline" className="shrink-0">
          <Link href={`/dashboard/${appId}/products`}>
            <ArrowLeft className="size-4" />
            Back to products
          </Link>
        </Button>
      </div>

      <EditProductForm key={product.id} product={product} />
    </div>
  )
}
