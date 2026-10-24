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
import { toast } from "sonner"

export function CreateNewKeyForm() {
  const { appId } = useParams<{ appId: string }>()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function handleOpenChange(nextOpen: boolean) {
    if (pending) return

    setOpen(nextOpen)

    if (!nextOpen) {
      setCreatedKey(null)
      setCopied(false)
      setError(null)
    }
  }

  async function copyKey() {
    if (!createdKey) return
    setError(null)

    try {
      await navigator.clipboard.writeText(createdKey)
      setCopied(true)
    } catch {
      toast.error("Failed to copy key to clipboard")
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const form = event.currentTarget
    const name = String(new FormData(form).get("name") ?? "").trim()
    setError(null)

    if (!name) {
      setError("Key name is required")
      return
    }

    setPending(true)

    try {
      const response = await fetch(
        `/api/apps/${encodeURIComponent(appId)}/keys`,
        {
          method: "POST",
          body: JSON.stringify({ name }),
        }
      )

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error ?? "Failed to create key")
      }

      const data = await response.json()
      if (typeof data?.apiKey !== "string" || !data.apiKey) {
        throw new Error("The server did not return the API key")
      }

      setCreatedKey(data.apiKey)
      setCopied(false)
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create key")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="size-4" />
          <div className="font-medium">Create Key</div>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        {createdKey ? (
          <>
            <DialogHeader>
              <DialogTitle>API key created</DialogTitle>
              <DialogDescription>
                Copy this key now. You will not be able to see it again.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <Label htmlFor="created-key">API key</Label>
              <Input
                id="created-key"
                value={createdKey}
                readOnly
                autoFocus
                className="font-mono"
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Done
                </Button>
              </DialogClose>

              <Button type="button" onClick={copyKey}>
                {copied ? "Copied" : "Copy key"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-6">
            <DialogHeader>
              <DialogTitle>Create New Key</DialogTitle>
              <DialogDescription>
                Create a new API key for your application
              </DialogDescription>
            </DialogHeader>

            <FieldGroup>
              <Field>
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" placeholder="Development" />
              </Field>
            </FieldGroup>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter className="-mx-6 -mb-6 rounded-b-xl border-t bg-secondary p-4">
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={pending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : "Create Key"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
