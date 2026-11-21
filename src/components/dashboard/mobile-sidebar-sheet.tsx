"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { LogOut, X, Store } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { allNavItems, businessNav, isActivePath, primaryNav, utilityNav } from "@/components/shell/app-sidebar"
import { useLanguage, type TranslationKey } from "@/lib/i18n/language"
import { useAuth } from "@/components/providers/auth-provider"

export interface MobileSidebarSheetProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * The mobile drawer — the reference's sidebar, on a phone.
 *
 * The chrome is dark here too, so the drawer feels like the same instrument
 * rather than a different app.
 */
export default function MobileSidebarSheet({ isOpen, onClose }: MobileSidebarSheetProps) {
  const pathname = usePathname()
  const { t, direction } = useLanguage()
  const { user } = useAuth()

  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "مستخدم"

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = "/login"
  }

  const renderGroup = (title: string, titleKey: TranslationKey, items: typeof allNavItems) => (
    <div className="mb-1">
      <p className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-chrome-faint/80">
        {t(titleKey)}
      </p>
      <div className="space-y-px">
        {items.map((item) => {
          const active = isActivePath(pathname, item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "bg-chrome-accent text-chrome-accent-foreground"
                  : "text-chrome-muted hover:bg-chrome-2 hover:text-chrome-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t(item.nameKey)}
            </Link>
          )
        })}
      </div>
    </div>
  )

  return (
    <Sheet open={isOpen} onOpenChange={onClose} direction={direction === "rtl" ? "right" : "left"}>
      <SheetContent className="chrome-surface w-[270px] border-chrome-border p-0 text-chrome-foreground">
        <div className="flex h-full flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-chrome-border px-3">
            <Link href="/dashboard" onClick={onClose} className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-chrome-accent">
                <Store className="h-[15px] w-[15px] text-chrome-accent-foreground" aria-hidden="true" />
              </span>
              <span className="text-[13px] font-semibold">{t("brand.name")}</span>
            </Link>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-chrome-muted transition-colors hover:bg-chrome-2 hover:text-chrome-foreground"
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 py-1.5" aria-label={t("nav.home")}>
            <div className="space-y-px">
              {primaryNav.map((item) => {
                const active = isActivePath(pathname, item.href)
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium transition-colors",
                      active
                        ? "bg-chrome-accent text-chrome-accent-foreground"
                        : "text-chrome-muted hover:bg-chrome-2 hover:text-chrome-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {t(item.nameKey)}
                  </Link>
                )
              })}
            </div>
            {businessNav.map((group) => renderGroup(group.title, group.titleKey, group.items))}
            {utilityNav.map((group) => renderGroup(group.title, group.titleKey, group.items))}
          </nav>

          <div className="shrink-0 border-t border-chrome-border p-2">
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[12.5px] text-chrome-muted transition-colors hover:bg-chrome-2 hover:text-chrome-foreground"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-chrome-accent text-[11px] font-semibold text-chrome-accent-foreground">
                {displayName.charAt(0)}
              </span>
              <span className="min-w-0 flex-1 truncate text-start">{displayName}</span>
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
