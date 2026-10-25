import { NavSidebar } from "@/components/nav-sidebar"
import { DashboardBreadcrumbs } from "@/components/dashboard-breadcrumbs"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { auth } from "@clerk/nextjs/server"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { apps } from "@/lib/schema"

export default async function PageLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const { userId } = await auth.protect()
  const userApps = await db.select().from(apps).where(eq(apps.ownerId, userId))

  return (
    <SidebarProvider>
      <NavSidebar apps={userApps} />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex min-w-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2" />
            <DashboardBreadcrumbs
              apps={userApps.map(({ id, name }) => ({ id, name }))}
            />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
