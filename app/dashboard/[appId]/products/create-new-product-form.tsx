"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { DialogClose, DialogFooter } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { useState, type SubmitEvent } from "react"
import { useParams, useRouter } from "next/navigation"
import { Plus } from "lucide-react"

export function CreateNewProductForm() {
  const { appId } = useParams<{ appId: string }>()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  function handleOpenChange(nextOpen: boolean) {
    if (pending) return
    setOpen(nextOpen)
    setError(null)
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const form = event.currentTarget
    const name = String(new FormData(form).get("name") ?? "").trim()
    setError(null)

    if (!name) {
      setError("Product name is required")
      return
    }

    setPending(true)

    try {
      const response = await fetch(
        `/api/apps/${encodeURIComponent(appId)}/products`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        }
      )

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error ?? "Failed to create product")
      }

      form.reset()
      setOpen(false)
      router.refresh()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to create product"
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="shrink-0">
          <Plus className="size-4" />
          <span className="font-medium">Create New Product</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>Create New Product</DialogTitle>
            <DialogDescription>
              Start a new product to manage your offerings
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field>
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="100 Gems" required />
            </Field>
          </FieldGroup>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="-mx-6 -mb-6 rounded-b-xl border-t bg-secondary p-4">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : "Create Product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
