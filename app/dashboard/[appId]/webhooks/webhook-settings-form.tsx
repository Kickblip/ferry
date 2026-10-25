"use client"

import { useState, type SubmitEvent } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"

export function WebhookSettingsForm({
  appId,
  initialUrl,
  initialSigningKey,
}: {
  appId: string
  initialUrl: string | null
  initialSigningKey: string | null
}) {
  const router = useRouter()
  const [url, setUrl] = useState(initialUrl ?? "")
  const [signingKey, setSigningKey] = useState(initialSigningKey ?? "")
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/apps/${encodeURIComponent(appId)}/webhook`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        }
      )
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to save webhook")
      }
      setUrl(data.url)
      setSigningKey(data.signingKey)
      setCopied(false)
      toast.success("Webhook saved")
      router.refresh()
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to save webhook"
      )
    } finally {
      setPending(false)
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(signingKey)
      setCopied(true)
    } catch {
      toast.error("Failed to copy signing key")
    }
  }

  return (
    <form onSubmit={save} className="grid w-full gap-4 md:max-w-sm">
      <div className="grid gap-2">
        <Label htmlFor="webhook-url">Callback URL</Label>
        <div className="flex gap-2">
          <Input
            id="webhook-url"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://your-app.com/webhooks/ferry"
            required
            maxLength={2048}
            disabled={pending}
          />
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="webhook-signing-key">Signing key</Label>
        <InputGroup>
          <InputGroupInput
            id="webhook-signing-key"
            value={signingKey}
            placeholder="Save a callback URL to create a key"
            readOnly
            className="font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              onClick={copyKey}
              disabled={!signingKey}
              aria-label={copied ? "Signing key copied" : "Copy signing key"}
              title={copied ? "Copied" : "Copy signing key"}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <p className="text-xs text-muted-foreground">
          Use this key on your server to verify Ferry webhook signatures.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
