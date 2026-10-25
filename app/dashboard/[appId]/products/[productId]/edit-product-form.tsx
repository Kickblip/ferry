"use client"

import { useState, type SubmitEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import type { products } from "@/lib/schema"
import { ProductImageUpload } from "./product-image-upload"

type Product = Pick<
  typeof products.$inferSelect,
  "id" | "appId" | "name" | "price" | "imageUrl"
>

export function EditProductForm({ product }: { product: Product }) {
  const router = useRouter()
  const [name, setName] = useState(product.name)
  const [price, setPrice] = useState((product.price / 100).toFixed(2))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setError(null)
    if (!name.trim()) {
      setError("Product name is required")
      return
    }
    setPending(true)

    try {
      const response = await fetch(
        `/api/apps/${encodeURIComponent(product.appId)}/products/${encodeURIComponent(product.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), price }),
        }
      )
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to update product")
      }
      setName(data.name)
      setPrice((data.price / 100).toFixed(2))
      toast.success("Product updated")
      router.refresh()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to update product"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid w-full items-start gap-8 lg:grid-cols-[minmax(0,32rem)_16rem]">
      <form
        onSubmit={save}
        className="w-full max-w-lg overflow-hidden rounded-md border"
      >
        <div className="grid gap-6 p-4">
          <FieldGroup>
            <Field>
              <Label htmlFor="product-name">Name</Label>
              <Input
                id="product-name"
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="100 Gems"
                required
                disabled={pending}
              />
            </Field>
            <Field>
              <Label htmlFor="product-price">Price (USD)</Label>
              <Input
                id="product-price"
                name="price"
                type="number"
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                min="0.01"
                max="21474836.47"
                step="0.01"
                required
                disabled={pending}
              />
            </Field>
          </FieldGroup>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end border-t bg-secondary p-4">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            {pending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </form>
      <div className="w-64 max-w-full">
        <ProductImageUpload
          appId={product.appId}
          productId={product.id}
          imageUrl={product.imageUrl}
          disabled={pending}
        />
      </div>
    </div>
  )
}
