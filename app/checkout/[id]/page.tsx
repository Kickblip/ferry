import { Logo } from "@/components/logo"
import Image from "next/image"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { MailIcon, CreditCardIcon } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export default function Page() {
  return (
    <main className="grid min-h-screen place-items-center bg-secondary">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-4 rounded-md bg-background p-4">
        <div className="flex items-center gap-4">
          <Image src="/" alt="" width={60} height={60} />
          <div className="flex flex-col">
            <p className="text-sm text-muted-foreground">100 Gems</p>
            <h1 className="text-2xl font-semibold">$5.99</h1>
          </div>
        </div>

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

          <Label className="text-xs text-muted-foreground">
            Shipping address
          </Label>
          <Input placeholder="Full Name" />

          <Input placeholder="Address" />

          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="City" />
            <Input placeholder="ZIP" />
          </div>

          <Input placeholder="State" />
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Payment Method</p>

          <InputGroup>
            <InputGroupInput placeholder="1234 1234 1234 1234" />
            <InputGroupAddon>
              <CreditCardIcon />
            </InputGroupAddon>
          </InputGroup>

          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="MM/YY" />
            <Input placeholder="CVV" />
          </div>
        </div>

        <Button className="font-medium">Pay</Button>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Powered by</span>
          <Logo className="text-muted-foreground" size={16} />
          <span>Ferry</span>
        </div>
      </div>
    </main>
  )
}
