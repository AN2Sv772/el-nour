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
  Settings,
  Link2,
  CheckCircle2,
  Banknote,
  Brain,
  Bot,
  ShieldCheck,
  LineChart,
  Lightbulb,
  Calculator,
  Sparkles,
  ShieldAlert,
  Bug,
  TrendingUp,
  FlaskConical,
  Store,
  Search,
  ChevronsLeft,
  ChevronsRight,
  type LucideIcon,
} from "lucide-react"

/**
 * The navigation tree — the shape of the product, not just a list of links.
 *
 * The reference groups the sidebar into a few domains (Business Dashboards,
 * Finance, Ads, Reports, Tools, Settings) and puts the icon rail on the far
 * edge. El Nour's tree follows the same logic: the owner thinks in
 * "what do I need to do today", not "which table do I query".
 */

export interface NavItem {
  /** The dictionary key — the Arabic `name` below is the fallback copy. */
  nameKey: TranslationKey
  name: string
  href: string
  icon: LucideIcon
}

export interface NavGroup {
  titleKey: TranslationKey
  title: string
  items: NavItem[]
}

/** The first group is the owner's daily loop. */
export const primaryNav: NavItem[] = [
  { nameKey: "nav.home", name: "الرئيسية", href: "/dashboard", icon: LayoutDashboard },
  { nameKey: "nav.brain", name: "عقل النشاط", href: "/brain", icon: Brain },
  { nameKey: "nav.agent", name: "المساعد", href: "/agent", icon: Bot },
  { nameKey: "nav.approvals", name: "الموافقات", href: "/approvals", icon: ShieldCheck },
]

/** The operating surfaces. */
export const businessNav: NavGroup[] = [
  {
    titleKey: "nav.group.sales",
    title: "المبيعات",
    items: [
      { nameKey: "nav.orders", name: "الطلبات", href: "/orders", icon: Package },
      { nameKey: "nav.customers", name: "العملاء", href: "/customers", icon: Users },
      { nameKey: "nav.products", name: "المنتجات", href: "/products", icon: Box },
    ],
  },
  {
    titleKey: "nav.group.money",
    title: "المال",
    items: [
      { nameKey: "nav.reconciliation", name: "التسوية اليومية", href: "/reconciliation", icon: CheckCircle2 },
      { nameKey: "nav.collections", name: "مطابقة التحصيل", href: "/collections", icon: Link2 },
      { nameKey: "nav.reports", name: "التقارير", href: "/reports", icon: FileSpreadsheet },
      { nameKey: "nav.analytics", name: "التحليلات", href: "/analytics", icon: LineChart },
    ],
  },
  {
    titleKey: "nav.group.intelligence",
    title: "الذكاء",
    items: [
      { nameKey: "nav.overview", name: "نظرة عامة", href: "/overview", icon: LayoutDashboard },
      { nameKey: "nav.briefing", name: "الإحاطة", href: "/briefing", icon: Sparkles },
      { nameKey: "nav.decisions", name: "القرارات", href: "/decisions", icon: Lightbulb },
      { nameKey: "nav.risk", name: "مخاطر التحصيل", href: "/risk", icon: ShieldAlert },
      { nameKey: "nav.anomalies", name: "الشذوذ", href: "/anomalies", icon: Bug },
      { nameKey: "nav.forecast", name: "التنبؤ", href: "/forecast", icon: TrendingUp },
      { nameKey: "nav.simulator", name: "محاكي الأرباح", href: "/simulator", icon: FlaskConical },
    ],
  },
]

export const utilityNav: NavGroup[] = [
  {
    titleKey: "nav.group.system",
    title: "النظام",
    items: [
      { nameKey: "nav.costs", name: "إدخال التكاليف", href: "/setup/costs", icon: Calculator },
      { nameKey: "nav.integrations", name: "تأكيد الطلبات والتكاملات", href: "/settings/integrations", icon: CheckCircle2 },
      { nameKey: "nav.settings", name: "الإعدادات", href: "/settings", icon: Settings },
    ],
  },
]

/** Flat list — used by the mobile drawer and by the command menu. */
export const allNavItems: NavItem[] = [
  ...primaryNav,
  ...businessNav.flatMap((g) => g.items),
  ...utilityNav.flatMap((g) => g.items),
]

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard"
  return pathname === href || pathname.startsWith(href + "/")
}

/**
 * One nav row.
 *
 * The active state is the reference's: a dark teal pill with a light teal
 * label and a teal icon — not a filled emerald block.
 */
export function NavRow({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const { t } = useLanguage()
  const Icon = item.icon
  const label = t(item.nameKey)
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-xl px-2.5 py-[7px] text-[12.5px] font-medium transition-colors duration-150",
        collapsed && "justify-center px-0",
        active
          ? "bg-chrome-accent text-chrome-accent-foreground"
          : "text-chrome-muted hover:bg-chrome-2 hover:text-chrome-foreground"
      )}
    >
      <Icon
        className={cn(
          "h-[15px] w-[15px] shrink-0 transition-colors",
          active ? "text-chrome-accent-foreground" : "text-chrome-faint group-hover:text-chrome-muted"
        )}
        aria-hidden="true"
      />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  )
}

export function NavSection({
  title,
  titleKey,
  children,
}: {
  title: string
  titleKey?: TranslationKey
  children: React.ReactNode
}) {
  const { t } = useLanguage()
  return (
    <div className="mb-1">
      <p className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-chrome-faint/80">
        {titleKey ? t(titleKey) : title}
      </p>
      <div className="space-y-px">{children}</div>
    </div>
  )
}

/**
 * The dark sidebar: an icon rail on the far edge (the logo, the search, the
 * account) and the navigation tree beside it — the reference's layout,
 * mirrored for RTL.
 */
export function AppSidebar({
  collapsed,
  onToggleCollapse,
  onNavigate,
}: {
  collapsed: boolean
  onToggleCollapse: () => void
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const { t } = useLanguage()

  return (
    <aside
      className={cn(
        "chrome-surface fixed inset-y-0 start-0 z-40 hidden flex-col border-e border-chrome-border",
        "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] lg:flex",
        collapsed ? "w-[64px]" : "w-[240px]"
      )}
      aria-label={t("nav.home")}
    >
      {/* The brand + the store switcher, the way the reference opens. */}
      <div
        className={cn(
          "flex h-10 shrink-0 items-center gap-2 border-b border-chrome-border",
          collapsed ? "justify-center px-2" : "px-3"
        )}
      >
        <Link
          href="/dashboard"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-chrome-accent"
          aria-label={`${t("brand.name")} — ${t("nav.home")}`}
        >
          <Store className="h-[15px] w-[15px] text-chrome-accent-foreground" aria-hidden="true" />
        </Link>
        {!collapsed && (
          <>
            <Link href="/dashboard" className="min-w-0 truncate text-[13px] font-semibold text-chrome-foreground">
              {t("brand.name")}
            </Link>
            <span className="ml-auto flex items-center gap-1 rounded-md bg-chrome-2 px-1.5 py-0.5 text-[11px] text-chrome-muted">
              {t("brand.store")}
              <ChevronsLeft className="h-3 w-3" aria-hidden="true" />
            </span>
          </>
        )}
      </div>

      {/* The tree. */}
      <nav
        className={cn(
          "flex-1 min-h-0 space-y-1 overflow-y-auto py-1.5",
          collapsed ? "px-2" : "px-2"
        )}
      >
        {!collapsed && (
          <div className="space-y-px">
            {primaryNav.map((item) => (
              <NavRow
                key={item.href}
                item={item}
                active={isActivePath(pathname, item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
        {collapsed && (
          <div className="space-y-px">
            {primaryNav.map((item) => (
              <NavRow
                key={item.href}
                item={item}
                active={isActivePath(pathname, item.href)}
                collapsed
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}

        {businessNav.map((group) => (
          <NavSection key={group.title} title={group.title} titleKey={group.titleKey}>
            {group.items.map((item) => (
              <NavRow
                key={item.href}
                item={item}
                active={isActivePath(pathname, item.href)}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </NavSection>
        ))}

        {utilityNav.map((group) => (
          <NavSection key={group.title} title={group.title} titleKey={group.titleKey}>
            {group.items.map((item) => (
              <NavRow
                key={item.href}
                item={item}
                active={isActivePath(pathname, item.href)}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </NavSection>
        ))}
      </nav>

      {/* The footer: collapse + the account. */}
      <div className={cn("shrink-0 border-t border-chrome-border", collapsed ? "p-2" : "p-2")}>
        <button
          onClick={onToggleCollapse}
          className={cn(
            "mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-chrome-faint transition-colors hover:bg-chrome-2 hover:text-chrome-foreground",
            collapsed && "justify-center px-0"
          )}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
              <span>{t("nav.collapse")}</span>
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
