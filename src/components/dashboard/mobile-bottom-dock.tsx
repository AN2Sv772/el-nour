"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useLanguage, type TranslationKey } from "@/lib/i18n/language"
import {
  LayoutDashboard,
  Package,
  Users,
  Box,
  FileSpreadsheet,
  LineChart,
  Settings,
  MoreHorizontal,
  Link2,
  CheckCircle2,
  Bot,
  X,
} from "lucide-react"

/**
 * The mobile bottom dock.
 *
 * WHY IT WAS REBUILT
 *
 * The previous version rendered EIGHT destinations plus a "more" button in a
 * single row (nine items across a 360 px screen) — every label was
 * truncated to unreadable slivers, and the tap targets were far below the
 * 44 px minimum. It also duplicated the navigation (the drawer sidebar and
 * the dock offered the same items side by side) and the component was never
 * actually rendered by the layout at all.
 *
 * Now: four primary destinations + a "more" sheet, with a real drawer for
 * the drawer-style navigation, and safe-area padding for notched devices.
 */

/** Always visible in the dock (max 4 + the more button = 5 tap targets). */
const primary: { nameKey: TranslationKey; href: string; icon: typeof LayoutDashboard }[] = [
  { nameKey: "nav.home", href: "/dashboard", icon: LayoutDashboard },
  { nameKey: "nav.orders", href: "/orders", icon: Package },
  { nameKey: "nav.customers", href: "/customers", icon: Users },
  { nameKey: "nav.products", href: "/products", icon: Box },
]

/** Everything else lives in the "more" sheet. The assistant lives here too:
    the floating launcher is desktop-only, and on the phone this sheet is how
    the owner still reaches it. */
const secondary: { nameKey: TranslationKey; href: string; icon: typeof LayoutDashboard }[] = [
  { nameKey: "nav.agent", href: "/agent", icon: Bot },
  { nameKey: "nav.reconciliation", href: "/reconciliation", icon: CheckCircle2 },
  { nameKey: "nav.collections", href: "/collections", icon: Link2 },
  { nameKey: "nav.analytics", href: "/analytics", icon: LineChart },
  { nameKey: "nav.reports", href: "/reports", icon: FileSpreadsheet },
  { nameKey: "nav.integrations", href: "/settings/integrations", icon: CheckCircle2 },
  { nameKey: "nav.settings", href: "/settings", icon: Settings },
]

export function MobileBottomDock() {
  const pathname = usePathname()
  const { t } = useLanguage()
  const [moreOpen, setMoreOpen] = React.useState(false)
  const sheetRef = React.useRef<HTMLDivElement>(null)
  const closeButtonRef = React.useRef<HTMLButtonElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  // Where focus was before the sheet opened, so it can be restored on close.
  const restoreFocusRef = React.useRef<HTMLElement | null>(null)

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/")
  const secondaryActive = secondary.some((item) => isActive(item.href))

  // Close the sheet on Escape, lock the page scroll, move focus into the
  // sheet and trap it there while it is open.
  //
  // A custom dialog that only sets `aria-modal` is not modal for keyboard
  // users: Tab still walks into the page behind it and screen-reader focus
  // stays on the trigger. So we do all three explicitly.
  React.useEffect(() => {
    if (!moreOpen) return

    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setMoreOpen(false)
        return
      }

      if (e.key !== "Tab") return

      // Trap Tab inside the sheet.
      const sheet = sheetRef.current
      if (!sheet) return
      const focusables = Array.from(
        sheet.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null)
      if (focusables.length === 0) return

      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (e.shiftKey && (active === first || !sheet.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    // Move focus into the sheet (the close button) once it is on screen.
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus()
    }, 0)

    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = previousOverflow
      window.clearTimeout(focusTimer)
      // Restore focus to whatever had it before the sheet opened.
      const restore = restoreFocusRef.current
      if (restore && document.body.contains(restore)) {
        restore.focus()
      } else {
        triggerRef.current?.focus()
      }
    }
  }, [moreOpen])

  // Close the sheet when the route changes.
  React.useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  return (
    <>
      {/* ─── More sheet ─── */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-[60] lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="المزيد"
          onClick={() => setMoreOpen(false)}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
          <div
            ref={sheetRef}
            className="absolute bottom-0 right-0 left-0 rounded-t-2xl bg-card border-t border-border shadow-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" aria-hidden="true" />
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-xs font-semibold text-muted-foreground">{t("nav.more")}</p>
              <button
                ref={closeButtonRef}
                onClick={() => setMoreOpen(false)}
                aria-label={t("common.close")}
                className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {secondary.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-3 py-3 text-sm font-medium transition-colors",
                    isActive(item.href)
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t(item.nameKey)}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Dock ─── */}
      <nav
        className={cn(
          "fixed bottom-0 right-0 left-0 z-50 lg:hidden",
          "bg-card/95 backdrop-blur-md border-t border-border",
          "pb-[env(safe-area-inset-bottom)]"
        )}
        aria-label={t("nav.home")}
      >
        <div className="flex items-stretch justify-around px-1 pt-1.5 pb-1">
          {primary.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-[60px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-2 transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <item.icon
                  className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")}
                  aria-hidden="true"
                />
                <span className="text-[11px] font-medium leading-tight">{t(item.nameKey)}</span>
              </Link>
            )
          })}

          <button
            ref={triggerRef}
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className={cn(
              "flex min-w-[60px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-2 transition-colors",
              secondaryActive || moreOpen ? "text-primary" : "text-muted-foreground"
            )}
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
            <span className="text-[11px] font-medium leading-tight">{t("nav.more")}</span>
          </button>
        </div>
      </nav>
    </>
  )
}
