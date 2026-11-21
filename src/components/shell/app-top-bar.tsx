"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTheme } from "@/hooks/use-client-theme"
import { useAuth } from "@/components/providers/auth-provider"
import { useLanguage, LANGUAGE_LABEL, type Language } from "@/lib/i18n/language"
import { Menu, Sun, Moon, Bell, ChevronDown, LogOut, Search, Languages, Store } from "lucide-react"

/**
 * The top chrome — the reference's 40px dark bar that sits above everything.
 *
 * It is dark in BOTH themes: the chrome frames the light canvas, and that
 * contrast is what makes the product read as an instrument rather than a
 * website.
 */
export function AppTopBar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const router = useRouter()
  const { resolvedTheme, setTheme } = useTheme()
  const { user } = useAuth()
  const { language, setLanguage, t } = useLanguage()

  const handleLogout = async () => {
    const { createClient } = await import("@/lib/supabase/client")
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
  }

  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "مستخدم"
  const initial = displayName.charAt(0)

  return (
    <header className="chrome-surface sticky top-0 z-30 flex h-10 shrink-0 items-center gap-2 border-b border-chrome-border px-2 sm:px-3">
      <button
        onClick={onOpenMobileNav}
        className="flex h-7 w-7 items-center justify-center rounded-md text-chrome-muted transition-colors hover:bg-chrome-2 hover:text-chrome-foreground lg:hidden"
        aria-label={t("topbar.openMenu")}
      >
        <Menu className="h-4 w-4" aria-hidden="true" />
      </button>

      {/* The store chip — the reference's identity of "whose business is this".
          Hidden when the sidebar is visible: the sidebar's own header already
          carries the brand and the store, and two identical chips in one row
          read as a bug. */}
      <Link
        href="/dashboard"
        className="hidden h-7 items-center gap-1.5 rounded-lg bg-chrome-2 px-2 text-[12px] font-medium text-chrome-foreground transition-colors hover:bg-chrome-3 sm:flex lg:hidden"
      >
        <Store className="h-3.5 w-3.5 text-chrome-accent-foreground" aria-hidden="true" />
        {t("brand.store")}
        <ChevronDown className="h-3 w-3 text-chrome-faint" aria-hidden="true" />
      </Link>

      {/* The command/search affordance — a shortcut, not a real search yet. */}
      <button
        className="hidden h-7 items-center gap-2 rounded-lg bg-chrome-2 px-2 text-[12px] text-chrome-faint transition-colors hover:bg-chrome-3 hover:text-chrome-muted md:flex"
        onClick={() => router.push("/orders")}
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{t("topbar.search")}</span>
        <kbd className="ms-auto rounded border border-chrome-border px-1 text-[10px] text-chrome-faint">⌘K</kbd>
      </button>

      <div className="ms-auto flex items-center gap-1">
        {/* The theme switch — a small chip, not a big icon button. */}
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-chrome-muted transition-colors hover:bg-chrome-2 hover:text-chrome-foreground"
          aria-label={resolvedTheme === "dark" ? t("topbar.theme.light") : t("topbar.theme.dark")}
          title={resolvedTheme === "dark" ? t("topbar.theme.light") : t("topbar.theme.dark")}
        >
          {resolvedTheme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>

        <button
          className="relative flex h-7 w-7 items-center justify-center rounded-md text-chrome-muted transition-colors hover:bg-chrome-2 hover:text-chrome-foreground"
          aria-label={t("topbar.notifications")}
        >
          <Bell className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        <span className="mx-1 hidden h-4 w-px bg-chrome-border sm:block" aria-hidden="true" />

        {/* The language switch — a real switch, not a label that says
            "coming soon". It flips the whole document's direction, so the
            layout mirrors instead of only translating the chrome. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-[12px] text-chrome-muted transition-colors hover:bg-chrome-2 hover:text-chrome-foreground"
              aria-label={t("topbar.language")}
            >
              <Languages className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{LANGUAGE_LABEL[language]}</span>
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 rounded-lg p-1">
            {(["ar", "en"] as Language[]).map((code) => (
              <DropdownMenuItem
                key={code}
                className="cursor-pointer rounded-md text-[13px]"
                onSelect={() => setLanguage(code)}
                data-active={language === code || undefined}
              >
                {LANGUAGE_LABEL[code]}
                {language === code && (
                  <span className="ms-auto text-[10px] text-primary">●</span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-7 items-center gap-1.5 rounded-lg px-1 text-[12px] text-chrome-foreground transition-colors hover:bg-chrome-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-chrome-accent text-[11px] font-semibold text-chrome-accent-foreground">
                {initial}
              </span>
              <span className="hidden max-w-[120px] truncate sm:inline">{displayName}</span>
              <ChevronDown className="h-3 w-3 text-chrome-faint" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-lg p-1">
            <DropdownMenuItem
              className="cursor-pointer rounded-md text-[13px] text-destructive focus:text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              {t("topbar.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
