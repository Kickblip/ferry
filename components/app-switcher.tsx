"use client"

import { ChevronsUpDown, Plus } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog"
import { Field, FieldGroup } from "./ui/field"
import { Label } from "./ui/label"
import { Input } from "./ui/input"
import { Button } from "./ui/button"
import type { apps as appsTable } from "@/lib/schema"
import { useState, type SubmitEvent } from "react"
import { useRouter, useParams } from "next/navigation"
import { Spinner } from "./ui/spinner"

export function AppSwitcher({
  apps,
}: {
  apps: (typeof appsTable.$inferSelect)[]
}) {
  const router = useRouter()
  const { isMobile } = useSidebar()
  const { appId } = useParams()
  const activeApp = apps.find((app) => app.id === appId) ?? apps[0]
  const [open, setOpen] = useState(false)

  if (!activeApp) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>
            <Plus className="size-4" />
            <div className="font-medium">Create Application</div>
          </Button>
        </DialogTrigger>

        <CreateAppForm onCreated={() => setOpen(false)} />
      </Dialog>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <Dialog open={open} onOpenChange={setOpen}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  {activeApp.name.charAt(0).toUpperCase()}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{activeApp.name}</span>
                  <span className="truncate text-xs">sdfsdf</span>
                </div>
                <ChevronsUpDown className="ml-auto" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              align="start"
              side={isMobile ? "bottom" : "right"}
              sideOffset={4}
            >
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Applications
              </DropdownMenuLabel>
              {apps.map((app, index) => (
                <DropdownMenuItem
                  key={app.name}
                  onSelect={() => router.push(`/dashboard/${app.id}`)}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    {app.name.charAt(0).toUpperCase()}
                  </div>
                  {app.name}
                  <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />

              <DialogTrigger asChild>
                <DropdownMenuItem className="gap-2 p-2">
                  <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                    <Plus className="size-4" />
                  </div>
                  <div className="font-medium text-muted-foreground">
                    Add app
                  </div>
                </DropdownMenuItem>
              </DialogTrigger>
            </DropdownMenuContent>
          </DropdownMenu>

          <CreateAppForm onCreated={() => setOpen(false)} />
        </Dialog>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function CreateAppForm({ onCreated }: { onCreated: () => void }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const formData = new FormData(event.currentTarget)
    setPending(true)
    setError(null)

    try {
      const response = await fetch("/api/apps", {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error ?? "Failed to create app")
      }

      const createdApp = await response.json()

      onCreated()
      router.push(`/dashboard/${createdApp.id}`)
      router.refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create app")
    } finally {
      setPending(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-sm">
      <form onSubmit={handleSubmit} className="grid gap-6">
        <DialogHeader>
          <DialogTitle>Create New Application</DialogTitle>
          <DialogDescription>
            Start a new application to manage products
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field>
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" placeholder="Acme Inc" />
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
            {pending ? <Spinner /> : "Create App"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
