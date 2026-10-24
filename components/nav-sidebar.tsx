"use client"

import { AppSwitcher } from "@/components/app-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { UserButton } from "@clerk/nextjs"
import type { apps as appsTable } from "@/lib/schema"

export function NavSidebar({
  apps,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  apps: (typeof appsTable.$inferSelect)[]
}) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <AppSwitcher apps={apps} />
      </SidebarHeader>
      <SidebarContent>
        <></>
      </SidebarContent>
      <SidebarFooter>
        <UserButton />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
