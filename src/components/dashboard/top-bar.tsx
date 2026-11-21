"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useSearchParams, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Toaster } from "sonner"
import { useTheme } from "@/hooks/use-client-theme"
import {
  Search,
  Bell,
  ChevronLeft,
  ChevronRight,
  LogOut,
  User,
  ChevronDown,
  Sun,
  Moon,
  Menu,
  X,
  Settings,
  LayoutDashboard,
  Package,
  Users,
  Box,
  FileSpreadsheet,
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
} from "lucide-react"
import { AvatarImage } from "@/components/ui/avatar"
import { useEffect, useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"

const navigation = [
  { name: "لوحة التحكم", href: "/dashboard", icon: LayoutDashboard },
  { name: "عقل النشاط", href: "/brain", icon: Brain },
  { name: "المساعد", href: "/agent", icon: Bot },
  { name: "الموافقات", href: "/approvals", icon: ShieldCheck },
  { name: "الطلبات", href: "/orders", icon: Package },
  { name: "العملاء", href: "/customers", icon: Users },
  { name: "المنتجات", href: "/products", icon: Box },
  { name: "التحليلات", href: "/analytics", icon: LineChart },
  { name: "نظرة عامة", href: "/overview", icon: LayoutDashboard },
  { name: "الإحاطة", href: "/briefing", icon: Sparkles },
  { name: "مخاطر التحصيل", href: "/risk", icon: ShieldAlert },
  { name: "الشذوذ", href: "/anomalies", icon: Bug },
  { name: "التنبؤ", href: "/forecast", icon: TrendingUp },
  { name: "محاكي الأرباح", href: "/simulator", icon: FlaskConical },
  { name: "إدخال التكاليف", href: "/setup/costs", icon: Calculator },
  { name: "القرارات", href: "/decisions", icon: Lightbulb },
  { name: "التقارير", href: "/reports", icon: FileSpreadsheet },
  { name: "الإعدادات", href: "/settings", icon: Settings },
]

export function TopBar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [notificationsOpen, setNotificationsOpen] = React.useState(false)
  const { resolvedTheme, setTheme } = useTheme()
  const mountedRef = useRef(false)
  const [user, setUser] = React.useState<{ name: string; email: string; avatar?: string } | null>(null)

  useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true
    // Fetch user data
    const fetchUser = async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          setUser({
            name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'مستخدم',
            email: user.email || '',
            avatar: user.user_metadata?.avatar_url,
          })
        }
      } catch (error) {
        console.error('Failed to fetch user:', error)
      }
    }
    fetchUser()
  }, [])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      // Navigate to search results or filter current page
      const searchParams = new URLSearchParams()
      searchParams.set('search', searchQuery.trim())
      router.push(`/dashboard?${searchParams.toString()}`)
    }
  }

  return (
    <>
      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Top Bar */}
      <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 lg:px-6">
        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="فتح القائمة"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Sidebar collapse/expand button (desktop only) */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden lg:flex"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? "توسيع الشريط الجانبي" : "طي الشريط الجانبي"}
        >
          {sidebarCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </Button>

        {/* Breadcrumb */}
        <div className="flex-1 min-w-0 lg:max-w-xl">
          <Breadcrumb />
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-2">
          {/* Global Search */}
          <form onSubmit={handleSearch} className="hidden md:flex relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="ابحث في كل شيء..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSearch(e as React.FormEvent)
                }
              }}
              className="input-premium pl-10 w-[280px]"
            />
          </form>

          {/* Theme Toggle */}
          {/* The icon follows the RESOLVED theme. With the preference set to
              "system" the old code compared `theme === "dark"`, which is
              always false — so the page was dark while the button still
              offered to switch TO dark. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label={resolvedTheme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}
            title={resolvedTheme === "dark" ? "الوضع الفاتح" : "الوضع الداكن"}
          >
            {resolvedTheme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>

          {/* Notifications */}
          <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="الإشعارات">
                <Bell className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 rounded-xl border border-border bg-popover p-1 shadow-premium-elevated">
              <div className="p-2 border-b border-border">
                <h3 className="font-semibold text-sm">الإشعارات</h3>
              </div>
              <div className="max-h-96 overflow-y-auto">
                <div className="p-4 text-center text-muted-foreground">
                  لا توجد إشعارات جديدة
                </div>
              </div>
              <div className="p-2 border-t border-border">
                <Button variant="link" className="w-full justify-start" asChild>
                  <a href="/notifications">عرض جميع الإشعارات</a>
                </Button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 h-10 px-3" aria-label="قائمة المستخدم">
                <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full">
                  {user?.avatar ? (
                    <AvatarImage src={user.avatar} alt={user.name} />
                  ) : (
                    <div className="h-full w-full rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-xs font-medium text-primary">
                        {user?.name?.charAt(0) || "م"}
                      </span>
                    </div>
                  )}
                </div>
                <div className="hidden lg:block text-start">
                  <p className="font-medium text-sm truncate">{user?.name || "مدير النظام"}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email || "admin@elnour.com"}</p>
                </div>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-xl border border-border bg-popover p-1 shadow-premium-elevated">
              <DropdownMenuItem asChild className="rounded-xl px-3 py-2 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground">
                <Link href="/settings/profile" className="flex items-center gap-2 w-full">
                  <User className="h-4 w-4" />
                  الملف الشخصي
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1 border-border" />
              <DropdownMenuItem asChild className="rounded-xl px-3 py-2 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground">
                <Link href="/settings" className="flex items-center gap-2 w-full">
                  <Settings className="h-4 w-4" />
                  الإعدادات
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="my-1 border-border" />
              <DropdownMenuItem className="rounded-xl px-3 py-2 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent focus:text-accent-foreground text-destructive focus:text-destructive" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                تسجيل الخروج
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </>
  )
}

export function PageHeader({ title, description, actions }: { 
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="page-header-premium">
      <div>
        <h1 className="page-title-premium">{title}</h1>
        {description && <p className="page-description-premium">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
