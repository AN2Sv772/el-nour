"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Toaster } from "sonner"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { AppTopBar } from "@/components/shell/app-top-bar"
import { MobileSidebar } from "@/components/dashboard/mobile-sidebar"
import { MobileBottomDock } from "@/components/dashboard/mobile-bottom-dock"
import { AiLauncher } from "@/components/shell/ai-launcher"

/**
 * The application shell.
 *
 * The reference's structure, mirrored for RTL:
 *   ┌──────────────────────────────────────────────┐
 *   │  the dark chrome bar (40px, always dark)      │
 *   ├──────────┬───────────────────────────────────┤
 *   │  dark    │  the light canvas                  │
 *   │  sidebar │  ┌─────────────────────────────┐  │
 *   │  240px   │  │  the page                    │  │
 *   └──────────┴──┴─────────────────────────────┘  │
 *
 * The sidebar can collapse to an icon rail, exactly as in the reference.
 */
export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem("elnour.sidebar.collapsed")
      if (stored === "1") setCollapsed(true)
    } catch {
      /* a private-mode browser has no storage — the default is fine */
    }
  }, [])

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem("elnour.sidebar.collapsed", next ? "1" : "0")
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  return (
    /* No `dir` here on purpose: the shell inherits the document's direction,
       which the language provider flips on <html>. Hard-coding `dir="rtl"`
       used to pin the sidebar to the right even in English, so switching to
       English translated the labels but never mirrored the layout. */
    <div className="flex h-screen bg-background">
      <AppSidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        onNavigate={() => setMobileOpen(false)}
      />

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col overflow-hidden transition-[margin] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
          collapsed ? "lg:ms-[64px]" : "lg:ms-[240px]"
        )}
      >
        <AppTopBar onOpenMobileNav={() => setMobileOpen(true)} />

        {/* The canvas: the reference's #f6f7f9 with the content floating on
            it. The extra bottom padding keeps the mobile dock from covering
            the last row. */}
        <main id="main-content" className="flex-1 overflow-y-auto px-3 pb-24 pt-4 sm:px-4 lg:px-5 lg:pb-16">
          <div className="animate-fade-in mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>

      <MobileSidebar isOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <MobileBottomDock />
      <AiLauncher />
      <Toaster position="top-center" />
    </div>
  )
}
