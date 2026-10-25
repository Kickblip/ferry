"use client"

import { AppSwitcher } from "@/components/app-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { UserButton } from "@clerk/nextjs"
import type { apps as appsTable } from "@/lib/schema"
import Link from "next/link"
import { HouseHeart, Key, ShoppingBag, Webhook } from "lucide-react"
import { useParams } from "next/navigation"

export function NavSidebar({
  apps,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  apps: (typeof appsTable.$inferSelect)[]
}) {
  const { appId } = useParams()

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <AppSwitcher apps={apps} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Dashboard">
                  <Link href={`/dashboard/${appId}`}>
                    <HouseHeart />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Products">
                  <Link href={`/dashboard/${appId}/products`}>
                    <ShoppingBag />
                    <span>Products</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarGroupLabel>Settings</SidebarGroupLabel>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="API Keys">
                  <Link href={`/dashboard/${appId}/keys`}>
                    <Key />
                    <span>API Keys</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Webhooks">
                  <Link href={`/dashboard/${appId}/webhooks`}>
                    <Webhook />
                    <span>Webhooks</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserButton />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
