"use client"

import { use, useEffect, useRef, useState } from "react"
import { Logo } from "@/components/logo"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { MailIcon, CreditCardIcon } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import type { checkoutView } from "@/lib/payments/views"

type Checkout = ReturnType<typeof checkoutView>

async function requestCheckout(
  url: string,
  options?: RequestInit
): Promise<Checkout> {
  const response = await fetch(url, { cache: "no-store", ...options })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(body.error?.message ?? "Could not load this checkout.")
  }
  return body
}

function safeReturnUrl(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    if (
      [
        "javascript:",
        "data:",
        "vbscript:",
        "file:",
        "blob:",
        "about:",
      ].includes(url.protocol)
    )
      return null
    return url.toString()
  } catch {
    return null
  }
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <CheckoutForm key={id} id={id} />
}

function CheckoutForm({ id }: { id: string }) {
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const endpoint = `/api/checkout/${encodeURIComponent(id)}`

  useEffect(() => {
    const controller = new AbortController()
    requestCheckout(endpoint, { signal: controller.signal })
      .then(setCheckout)
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message)
      })
    return () => controller.abort()
  }, [endpoint])

  const ready = checkout?.status === "REQUIRES_CONFIRMATION"
  const succeeded = checkout?.status === "SUCCEEDED"
  const needsDeposit = succeeded && !checkout.settled
  const amount = checkout
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: checkout.currency,
      }).format(checkout.amountCents / 100)
    : ""
  const returnUrl = safeReturnUrl(checkout?.returnUrl ?? null)

  async function pay() {
    if (busy.current || (!ready && !needsDeposit)) return
    busy.current = true
    setPending(true)
    setError(null)
    try {
      setCheckout(
        await requestCheckout(`${endpoint}/confirm`, { method: "POST" })
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not complete checkout."
      try {
        // The payment may have succeeded even if its response was lost.
        const latest = await requestCheckout(endpoint)
        setCheckout(latest)
        if (latest.status !== "SUCCEEDED") setError(message)
      } catch {
        setError(message)
      }
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-secondary">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-4 rounded-md bg-background p-4">
        <div className="flex items-center gap-4">
          <div className="grid size-14 shrink-0 place-items-center rounded-md bg-secondary">
            <Logo size={32} />
          </div>
          <div className="flex flex-col">
            <p className="text-sm text-muted-foreground">
              {checkout?.description ?? "Checkout"}
            </p>
            <h1 className="text-2xl font-semibold">{amount}</h1>
            {checkout && (
              <p className="text-xs text-muted-foreground">
                {checkout.merchant.name}
              </p>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Demo checkout. No real charge. Shipping details are optional and
          aren’t saved.
        </p>

        {!checkout && !error && (
          <p role="status" className="text-sm">
            Loading checkout…
          </p>
        )}

        {ready && (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Shipping Information</p>
              <Label
                className="text-xs text-muted-foreground"
                htmlFor="shipping-email"
              >
                Email
              </Label>
              <InputGroup>
                <InputGroupInput
                  id="shipping-email"
                  type="email"
                  placeholder="Enter your email"
                />
                <InputGroupAddon>
                  <MailIcon />
                </InputGroupAddon>
              </InputGroup>

              <Label
                className="text-xs text-muted-foreground"
                htmlFor="shipping-address"
              >
                Shipping address
              </Label>
              <Input aria-label="Full name" placeholder="Full Name" />

              <Input id="shipping-address" placeholder="Address" />

              <div className="grid grid-cols-2 gap-2">
                <Input aria-label="City" placeholder="City" />
                <Input aria-label="ZIP" placeholder="ZIP" />
              </div>

              <Input aria-label="State" placeholder="State" />
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Payment Method (Demo)</p>

              <InputGroup>
                <InputGroupInput
                  aria-label="Demo card number"
                  value="4242 4242 4242 4242"
                  readOnly
                />
                <InputGroupAddon>
                  <CreditCardIcon />
                </InputGroupAddon>
              </InputGroup>

              <div className="grid grid-cols-2 gap-2">
                <Input aria-label="Demo expiration" value="12/30" readOnly />
                <Input aria-label="Demo CVV" value="123" readOnly />
              </div>
            </div>
          </>
        )}

        {succeeded && (
          <p role="status" className="text-sm">
            {checkout.settled
              ? `Payment successful! ${amount} was credited to Ferry’s simulated Nessie account.`
              : "Payment successful! The Nessie deposit is pending. Retry the deposit to finish the simulation."}
          </p>
        )}

        {checkout && !ready && !succeeded && (
          <p role="status" className="text-sm">
            {checkout.status === "EXPIRED"
              ? "This checkout expired. Start a new checkout to continue."
              : checkout.status === "CANCELED"
                ? "This checkout was canceled."
                : checkout.status === "PROCESSING"
                  ? "This checkout is processing. Refresh to check its status."
                  : (checkout.failureMessage ??
                    "This checkout could not be completed.")}
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {(ready || needsDeposit) && (
          <Button
            type="button"
            className="font-medium"
            onClick={pay}
            disabled={pending}
          >
            {pending
              ? "Processing…"
              : needsDeposit
                ? "Retry Nessie deposit"
                : `Pay ${amount}`}
          </Button>
        )}

        {returnUrl && (
          <Button asChild variant="outline">
            <a href={returnUrl}>Return to {checkout?.merchant.name}</a>
          </Button>
        )}

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Powered by</span>
          <Logo className="text-muted-foreground" size={16} />
          <span>Ferry</span>
        </div>
      </div>
    </main>
  )
}
