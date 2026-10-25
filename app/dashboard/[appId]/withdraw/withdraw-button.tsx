"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export function WithdrawButton({
  appId,
  disabled,
  retry,
}: {
  appId: string
  disabled: boolean
  retry: boolean
}) {
  const router = useRouter()
  const busy = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function withdraw() {
    if (busy.current || disabled || refreshing) return
    busy.current = true
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/apps/${appId}/withdraw`, {
        method: "POST",
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? "Unable to withdraw")
      if (data.status === "PAID") {
        const amount = new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(data.amountCents / 100)
        toast.success(`${amount} sent to your Nessie account`)
      } else {
        setError(
          "Nessie hasn't confirmed the transfer yet. Retry to finish this withdrawal."
        )
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to withdraw. Please try again."
      )
    } finally {
      startTransition(() => router.refresh())
      busy.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        onClick={withdraw}
        disabled={disabled || submitting || refreshing}
      >
        {submitting || refreshing ? <Spinner /> : <ArrowUpRight />}
        {submitting
          ? "Withdrawing…"
          : retry
            ? "Retry withdrawal"
            : "Withdraw balance"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
