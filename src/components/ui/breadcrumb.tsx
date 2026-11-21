"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { ChevronLeft, Home } from "lucide-react"

interface BreadcrumbItem {
  label: string
  href?: string
  isCurrent?: boolean
}

interface BreadcrumbProps {
  items?: BreadcrumbItem[]
  className?: string
  separator?: React.ReactNode
}

const routeLabels: Record<string, string> = {
  dashboard: "لوحة التحكم",
  orders: "الطلبات",
  customers: "العملاء",
  products: "المنتجات",
  inbox: "صندوق رسائل واتساب",
  reports: "التقارير",
  settings: "الإعدادات",
  login: "تسجيل الدخول",
  register: "إنشاء حساب",
  profile: "الملف الشخصي",
  edit: "تعديل",
  details: "التفاصيل",
  new: "جديد",
  create: "إنشاء",
}

export function Breadcrumb({ items, className, separator = <ChevronLeft className="h-4 w-4" aria-hidden="true" /> }: BreadcrumbProps) {
  const pathname = usePathname()
  
  // Generate breadcrumbs from pathname if items not provided
  const breadcrumbItems = items || generateBreadcrumbsFromPath(pathname)

  if (breadcrumbItems.length <= 1) return null

  return (
    <nav
      className={cn("flex items-center gap-1.5 text-sm", className)}
      aria-label="مسار التنقل"
    >
      <ol className="flex items-center gap-1.5" role="list">
        <li>
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 rounded-md"
            aria-label="الرئيسية"
          >
            <Home className="h-4 w-4" />
          </Link>
        </li>
        {breadcrumbItems.map((item, index) => (
          <li key={item.label || index} className="flex items-center gap-1.5">
            <span className="text-muted-foreground/50" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
            {item.isCurrent || (!item.href && index === breadcrumbItems.length - 1) ? (
              <span
                className={cn(
                  "text-sm font-medium text-foreground",
                  item.isCurrent && "truncate max-w-[200px]"
                )}
                aria-current="page"
              >
                {item.label}
              </span>
            ) : item.href ? (
              <Link
                href={item.href}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px] py-1 -my-1"
              >
                {item.label}
              </Link>
            ) : (
              <span className="text-sm font-medium text-foreground truncate max-w-[200px]">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

function generateBreadcrumbsFromPath(pathname: string): Array<{ label: string; href?: string; isCurrent?: boolean }> {
  const segments = pathname.split("/").filter(Boolean)
  const items: Array<{ label: string; href?: string; isCurrent?: boolean }> = []

  let currentPath = ""
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    currentPath += `/${segment}`
    
    // Skip dynamic segments (starting with [)
    if (segment.startsWith("[")) continue
    
    const isLast = i === segments.length - 1
    const label = routeLabels[segment] || segment
    
    items.push({
      label,
      href: isLast ? undefined : currentPath,
      isCurrent: isLast,
    })
  }

  return items
}

export function useBreadcrumb() {
  const pathname = usePathname()
  return generateBreadcrumbsFromPath(pathname)
}