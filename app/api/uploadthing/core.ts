import { auth } from "@clerk/nextjs/server"
import { and, eq } from "drizzle-orm"
import { createUploadthing, type FileRouter } from "uploadthing/next"
import { UploadThingError, UTApi } from "uploadthing/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { apps, products } from "@/lib/schema"

const f = createUploadthing()

export const ourFileRouter = {
  productImage: f(
    { image: { maxFileSize: "4MB", maxFileCount: 1, minFileCount: 1 } },
    { awaitServerData: true }
  )
    .input(z.object({ appId: z.uuid(), productId: z.uuid() }))
    .middleware(async ({ input }) => {
      const { userId } = await auth()
      if (!userId) throw new UploadThingError("Unauthorized")

      const [product] = await db
        .select({ id: products.id })
        .from(products)
        .innerJoin(apps, eq(products.appId, apps.id))
        .where(
          and(
            eq(products.id, input.productId),
            eq(products.appId, input.appId),
            eq(apps.ownerId, userId)
          )
        )
      if (!product) throw new UploadThingError("Product not found")
      return { userId, appId: input.appId, productId: product.id }
    })
    .onUploadComplete(async ({ metadata, file }) => {
      const previousKey = await db.transaction(async (tx) => {
        // Lock the product so simultaneous replacements cannot delete the current image.
        const [product] = await tx
          .select({ id: products.id, imageKey: products.imageKey })
          .from(products)
          .innerJoin(apps, eq(products.appId, apps.id))
          .where(
            and(
              eq(products.id, metadata.productId),
              eq(products.appId, metadata.appId),
              eq(apps.ownerId, metadata.userId)
            )
          )
          .for("update", { of: products })
        if (!product) throw new UploadThingError("Product not found")

        await tx
          .update(products)
          .set({ imageUrl: file.ufsUrl, imageKey: file.key })
          .where(eq(products.id, product.id))
        return product.imageKey
      })

      if (previousKey && previousKey !== file.key) {
        try {
          const deleted = await new UTApi().deleteFiles(previousKey)
          if (!deleted.success)
            console.error("Could not remove replaced product image")
        } catch {
          // shortcut: failed cleanup leaves the old file in storage; add retries if needed.
          console.error("Could not remove replaced product image")
        }
      }
      return { imageUrl: file.ufsUrl }
    }),
} satisfies FileRouter

export type OurFileRouter = typeof ourFileRouter
