"use client"

export const dynamic = 'force-dynamic'

import * as React from "react"
import { useState, useEffect, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { WhatsAppLink } from "@/components/shared/whatsapp-link"
import { formatCurrency, formatDate, formatPhoneNumber, cn } from "@/lib/utils"
import {
  Search,
  Plus,
  Filter,
  Download,
  MoreVertical,
  Eye,
  Edit,
  Package,
  DollarSign,
  Loader2,
  UserPlus,
  Users,
  ChevronRight,
  ChevronLeft,
} from "lucide-react"
import type { Customer } from "@/types"

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [search, setSearch] = useState("")
  const supabase = createClient()
  const loadingRef = useRef(true)

  const fetchCustomers = useCallback(async () => {
    try {
      loadingRef.current = true
      setLoading(true)
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      })
      if (search) params.append("search", search)

      const response = await fetch(`/api/customers?${params}`)
      const data = await response.json()
      
      if (data.data) {
        setCustomers(data.data)
        setTotal(data.total)
      }
    } catch (error) {
      console.error("Fetch customers error:", error)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [page, pageSize, search])

  useEffect(() => {
    fetchCustomers()
  }, [fetchCustomers])

  const renderPagination = () => {
    if (total <= pageSize) return null
    return (
      <div className="flex items-center justify-between p-4 border-t border-border/50">
        <p className="text-sm text-muted-foreground">
          عرض {(page - 1) * pageSize + 1} إلى {Math.min(page * pageSize, total)} من {total} عميل
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="gap-1"
          >
            <ChevronRight className="h-4 w-4" />
            السابق
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={page * pageSize >= total}
            className="gap-1"
          >
            التالي
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  const renderTable = () => (
    <div className="overflow-x-auto">
      <Table className="table-premium">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px]">#</TableHead>
            <TableHead>الاسم</TableHead>
            <TableHead>الهاتف</TableHead>
            <TableHead>البريد الإلكتروني</TableHead>
            <TableHead>إجمالي الطلبات</TableHead>
            <TableHead>إجمالي الإنفاق</TableHead>
            <TableHead>آخر تفاعل</TableHead>
            <TableHead className="w-[80px]">إجراءات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                <div className="flex flex-col items-center gap-3">
                  <UserPlus className="h-12 w-12 text-muted-foreground/30" />
                  <p className="text-muted-foreground">لا توجد عملاء مطابقون</p>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            customers.map((customer, index) => (
              <TableRow key={customer.id} className="hover:bg-muted/30 transition-colors">
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {(page - 1) * pageSize + index + 1}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-sm font-medium text-primary">
                        {customer.name?.charAt(0) || "ع"}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium">{customer.name || "بدون اسم"}</p>
                      <p className="text-xs text-muted-foreground">{customer.email || "بدون بريد"}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span dir="ltr">{formatPhoneNumber(customer.phone)}</span>
                    <WhatsAppLink phone={customer.phone} />
                  </div>
                </TableCell>
                <TableCell>{customer.email || "-"}</TableCell>
                <TableCell className="font-medium">{customer.total_orders}</TableCell>
                <TableCell className="font-medium">{formatCurrency(customer.total_spent)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {customer.last_interaction_at ? formatDate(customer.last_interaction_at) : "-"}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      {/* The trigger is icon-only: it needs an accessible
                          name, otherwise a screen reader announces a bare
                          "button" (F-018). */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        aria-label={`إجراءات ${customer.name}`}
                        title={`إجراءات ${customer.name}`}
                      >
                        <MoreVertical className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="dropdown-premium w-52">
                      <DropdownMenuItem asChild className="dropdown-premium-item">
                        <a href={`/customers/${customer.id}`}>
                          <Eye className="h-4 w-4" />
                          عرض التفاصيل
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem className="dropdown-premium-item">
                        <Edit className="h-4 w-4" />
                        تعديل
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="my-1 border-border" />
                      <DropdownMenuItem className="dropdown-premium-item">
                        <Package className="h-4 w-4" />
                        طلبات العميل
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="my-1 border-border" />
                      <DropdownMenuItem className="dropdown-premium-item text-destructive focus:text-destructive">
                        <span className="h-4 w-4" />
                        حذف
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )

  let content
  if (loading) {
    content = (
      <div className="p-0">
        <div className="overflow-x-auto">
          <Table className="table-premium">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>الهاتف</TableHead>
                <TableHead>البريد الإلكتروني</TableHead>
                <TableHead>إجمالي الطلبات</TableHead>
                <TableHead>إجمالي الإنفاق</TableHead>
                <TableHead>آخر تفاعل</TableHead>
                <TableHead className="w-[80px]">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...Array(5)].map((_, i) => (
                <TableRow key={i} className="animate-pulse">
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    <div className="h-4 w-12 bg-muted rounded" />
                  </TableCell>
                  <TableCell><div className="h-4 w-24 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-4 w-24 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-4 w-32 bg-muted rounded" /></TableCell>
                  <TableCell className="font-medium"><div className="h-4 w-16 bg-muted rounded" /></TableCell>
                  <TableCell className="font-medium"><div className="h-4 w-20 bg-muted rounded" /></TableCell>
                  <TableCell className="text-sm text-muted-foreground"><div className="h-4 w-24 bg-muted rounded" /></TableCell>
                  <TableCell><div className="h-4 w-16 bg-muted rounded" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    )
  } else {
    content = (
      <div className="overflow-x-auto">
        {renderTable()}
        {renderPagination()}
      </div>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <PageHeader
          icon={Users}
          title="العملاء"
          description="إدارة بيانات العملاء وتاريخ طلباتهم."
          actions={
            <>
              <Button variant="outline" asChild className="gap-2">
                <a href="/reports?type=customers">
                  <Download className="h-4 w-4" />
                  تصدير Excel
                </a>
              </Button>
              <Button onClick={() => setPage(1)} className="gap-2">
                <UserPlus className="h-4 w-4" />
                عميل جديد
              </Button>
            </>
          }
        />

        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="form-label">بحث</label>
              <Input
                placeholder="اسم العميل، رقم الهاتف، البريد..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-premium"
              />
            </div>
            <Button variant="outline" onClick={() => { setSearch(""); setPage(1); }} className="gap-2">
              <Filter className="h-4 w-4" />
              مسح الفلاتر
            </Button>
          </div>
        </Card>

        {/* Customers Table */}
        <Card>
          <CardContent className="p-0">
            <div>
              {content}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
