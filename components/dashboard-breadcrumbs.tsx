"use client"

import { Fragment } from "react"
import Link from "next/link"
import { useParams, usePathname } from "next/navigation"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

const pageLabels: Record<string, string> = {
  products: "Products",
  withdraw: "Withdraw",
  keys: "API Keys",
  webhooks: "Webhooks",
}

export function DashboardBreadcrumbs({
  apps,
}: {
  apps: { id: string; name: string }[]
}) {
  const pathname = usePathname()
  const { appId, productId } = useParams<{
    appId?: string
    productId?: string
  }>()
  const app = apps.find((app) => app.id === appId)
  const section = pathname.split("/")[3]
  const home = appId ? `/dashboard/${appId}` : "/dashboard"
  const crumbs = [{ label: app?.name ?? "Dashboard", href: home }]

  if (appId) {
    crumbs.push({
      label: pageLabels[section] ?? "Dashboard",
      href: section ? `${home}/${section}` : home,
    })
    if (productId) crumbs.push({ label: "Edit Product", href: pathname })
  } else if (pathname === "/dashboard/new") {
    crumbs.push({ label: "New Application", href: pathname })
  }

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => (
          <Fragment key={`${index}-${crumb.href}`}>
            {index > 0 && <BreadcrumbSeparator className="shrink-0" />}
            <BreadcrumbItem className="min-w-0">
              {index === crumbs.length - 1 ? (
                <BreadcrumbPage className="truncate" title={crumb.label}>
                  {crumb.label}
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link
                    href={crumb.href}
                    className="max-w-40 truncate"
                    title={crumb.label}
                  >
                    {crumb.label}
                  </Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
