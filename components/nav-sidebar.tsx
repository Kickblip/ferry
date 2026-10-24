"use client"

import { AppSwitcher } from "@/components/app-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { UserButton } from "@clerk/nextjs"
import type { apps as appsTable } from "@/lib/schema"
import Link from "next/link"
import { HouseHeart, ShoppingBag } from "lucide-react"
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
