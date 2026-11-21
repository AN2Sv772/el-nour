"use client"

export const dynamic = 'force-dynamic'

import * as React from "react"
import { useState, useEffect, useCallback } from "react"
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
import { formatCurrency, cn } from "@/lib/utils"
import {
  Search,
  Plus,
  Filter,
  Download,
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  Package,
  Loader2,
  Box,
  ChevronRight,
  ChevronLeft,
} from "lucide-react"
import type { Product } from "@/types"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { createProductSchema } from "@/lib/validation"
import type { z } from "zod"

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [search, setSearch] = useState("")
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "out">("all")
  // Deactivated products stay out of the default catalogue, but they have to
  // remain reachable or they could never be re-activated.
  const [includeInactive, setIncludeInactive] = useState(false)
  const supabase = createClient()

  const [createProductOpen, setCreateProductOpen] = useState(false)
  const [creatingProduct, setCreatingProduct] = useState(false)
  // Feedback for the activate/deactivate action (HIG: "Show people when a
  // command can't be carried out" / "confirm that a significant action has
  // completed").
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busyProductId, setBusyProductId] = useState<string | null>(null)

  const productForm = useForm<z.infer<typeof createProductSchema>>({
    resolver: zodResolver(createProductSchema) as any,
    defaultValues: {
      name: '',
      sku: '',
      price: 0,
      stock_quantity: 0,
      track_inventory: true,
    },
  })

  /**
   * Activate / deactivate a product.
   *
   * The row menu used to offer "حذف" (delete) with NO handler and the API has
   * no DELETE endpoint — a visible action that did nothing. Deleting a
   * product that already appears on order lines would also break the
   * order_items foreign key, so the real, recoverable action is to deactivate
   * it: the product stops being sellable while its history stays intact.
   */
  const setProductActive = async (product: Product, isActive: boolean) => {
    if (!confirm(
      isActive
        ? `تفعيل "${product.name}"؟ سيظهر مجددًا في قائمة المنتجات.`
        : `إيقاف "${product.name}"؟ لن يظهر في المنتجات الجديدة، وسجل طلباته السابقة يبقى كما هو.`
    )) return

    setBusyProductId(product.id)
    setActionMsg(null)
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: isActive }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionMsg({ ok: false, text: d.error || 'تعذّر تنفيذ العملية' })
        return
      }
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, is_active: isActive } : p)))
      setActionMsg({ ok: true, text: isActive ? `تم تفعيل "${product.name}"` : `تم إيقاف "${product.name}"` })
    } catch {
      setActionMsg({ ok: false, text: 'تعذّر الوصول للخادم' })
    } finally {
      setBusyProductId(null)
    }
  }

  const fetchProducts = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      })
      if (search) params.append("search", search)
      if (stockFilter !== "all") params.append("stockFilter", stockFilter)
      if (includeInactive) params.append("includeInactive", "true")

      const response = await fetch(`/api/products?${params}`)
      const data = await response.json()
      
      if (data.data) {
        setProducts(data.data)
        setTotal(data.total)
      }
    } catch (error) {
      console.error("Fetch products error:", error)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, search, stockFilter, includeInactive])

  useEffect(() => {
    setLoading(true)
    fetchProducts()
  }, [fetchProducts])

  const getStockStatus = (product: Product) => {
    if (product.stock_quantity === 0) return { label: "نفد المخزون", color: "destructive" as const, icon: AlertTriangle }
    if (product.stock_quantity <= product.low_stock_threshold) return { label: "مخزون منخفض", color: "warning" as const, icon: AlertTriangle }
    return { label: "متوفر", color: "success" as const, icon: Package }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <PageHeader
          icon={Package}
          title="المنتجات"
          description="إدارة المخزون والمنتجات والأسعار."
          actions={
            <>
              <Button variant="outline" asChild className="gap-2">
                <a href="/reports?type=products">
                  <Download className="h-4 w-4" />
                  تصدير Excel
                </a>
              </Button>
              <Button onClick={() => setCreateProductOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                منتج جديد
              </Button>
            </>
          }
        />

        {/* Action feedback */}
        {actionMsg && (
          <div
            role={actionMsg.ok ? 'status' : 'alert'}
            aria-atomic="true"
            className={cn(
              'rounded-xl border px-4 py-3 text-sm',
              actionMsg.ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                : 'border-destructive-fill/40 bg-destructive/5 text-destructive'
            )}
          >
            {actionMsg.text}
          </div>
        )}

        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[300px]">
              <label className="form-label">البحث</label>
              <Input
                placeholder="اسم المنتج، SKU، الوصف..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="input-premium"
              />
            </div>
            <div className="min-w-[180px]">
              <label className="form-label">حالة المخزون</label>
              <Select value={stockFilter} onValueChange={(value) => setStockFilter(value as "all" | "low" | "out")}>
                <SelectTrigger className="input-premium h-10 w-full">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent className="dropdown-premium">
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="low">مخزون منخفض</SelectItem>
                  <SelectItem value="out">نفد المخزون</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-border px-3 text-sm select-none focus-within:ring-2 focus-within:ring-ring">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => { setIncludeInactive(e.target.checked); setPage(1); }}
                className="h-4 w-4 accent-primary"
                aria-label="عرض المنتجات الموقوفة"
              />
              عرض الموقوفة
            </label>
            <Button variant="outline" onClick={() => { setSearch(""); setStockFilter("all"); setIncludeInactive(false); setPage(1); }} className="gap-2">
              <Filter className="h-4 w-4" />
              مسح الفلاتر
            </Button>
          </div>
        </Card>

        {/* Products Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-12 text-center">
                <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table className="table-premium">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]">#</TableHead>
                        <TableHead>الصورة</TableHead>
                        <TableHead>المنتج</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>الفئة</TableHead>
                        <TableHead>السعر</TableHead>
                        <TableHead>التكلفة</TableHead>
                        <TableHead>المخزون</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead className="w-[100px]">إجراءات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {products.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                            <div className="flex flex-col items-center gap-3">
                              <Box className="h-12 w-12 text-muted-foreground/30" />
                              <p className="text-muted-foreground">لا توجد منتجات</p>
                            </div>
                          </TableCell>
                        </TableRow>
) : (
                        products.map((product, index) => (
                          <TableRow key={product.id} className="hover:bg-muted/30 transition-colors">
                            <TableCell className="font-mono text-sm text-muted-foreground">
                              {(page - 1) * pageSize + index + 1}
                            </TableCell>
                            <TableCell>
                              {product.images?.[0] ? (
                                <img src={product.images[0]} alt={product.name} className="h-12 w-12 rounded-lg object-cover" />
                              ) : (
                                <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                                  <Box className="h-6 w-6 text-muted-foreground" />
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-medium">{product.name}</p>
                                  {!product.is_active && (
                                    <Badge variant="secondary" className="gap-1">
                                      <PauseCircle className="h-3 w-3" aria-hidden="true" />
                                      موقوف
                                    </Badge>
                                  )}
                                </div>
                                {product.name_ar && <p className="text-sm text-muted-foreground">{product.name_ar}</p>}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                            <TableCell>{product.category || "-"}</TableCell>
                            <TableCell className="font-medium">{formatCurrency(product.price)}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {product.cost_price ? formatCurrency(product.cost_price) : "-"}
                            </TableCell>
                            <TableCell className="font-medium">
                              {product.track_inventory ? product.stock_quantity : "غير مُتتبع"}
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const s = getStockStatus(product)
                                return (
                                  <Badge variant={s.color} className="gap-1">
                                    {s.icon && <s.icon className="h-3 w-3" />}
                                    {s.label}
                                  </Badge>
                                )
                              })()}
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    {/* Icon-only trigger: give it a name that
                                        identifies the row (F-018). */}
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9"
                                      aria-label={`إجراءات ${product.name_ar || product.name}`}
                                      title={`إجراءات ${product.name_ar || product.name}`}
                                    >
                                      <MoreVertical className="h-4 w-4" aria-hidden="true" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="dropdown-premium w-48">
                                    <DropdownMenuItem asChild className="dropdown-premium-item">
                                      <a href={`/products/${product.id}`}>
                                        <Eye className="h-4 w-4" />
                                        عرض التفاصيل
                                      </a>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild className="dropdown-premium-item">
                                      <a href={`/products/${product.id}/edit`}>
                                        <Edit className="h-4 w-4" />
                                        تعديل
                                      </a>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="my-1 border-border" />
                                    <DropdownMenuItem
                                      className="dropdown-premium-item"
                                      disabled={busyProductId === product.id}
                                      onSelect={(e) => {
                                        e.preventDefault()
                                        void setProductActive(product, !product.is_active)
                                      }}
                                    >
                                      {product.is_active ? (
                                        <>
                                          <PauseCircle className="h-4 w-4" aria-hidden="true" />
                                          إيقاف المنتج
                                        </>
                                      ) : (
                                        <>
                                          <PlayCircle className="h-4 w-4" aria-hidden="true" />
                                          تفعيل المنتج
                                        </>
                                      )}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
</TableCell>
</TableRow>
                          )
                        )
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {total > pageSize && (
                  <div className="flex items-center justify-between p-4 border-t border-border/50">
                    <p className="text-sm text-muted-foreground">
                      عرض {(page - 1) * pageSize + 1} إلى {Math.min(page * pageSize, total)} من {total} منتج
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="gap-1"
                      >
                        <ChevronLeft className="h-4 w-4" />
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
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create Product Dialog */}
      <Dialog open={createProductOpen} onOpenChange={setCreateProductOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إضافة منتج جديد</DialogTitle>
            <DialogDescription>أضف منتجاً جديداً للمخزون</DialogDescription>
          </DialogHeader>
          <form onSubmit={productForm.handleSubmit(async (values) => {
            setCreatingProduct(true)
            try {
              const response = await fetch('/api/products', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(values),
              })
              if (!response.ok) throw new Error('Failed to create product')
              const result = await response.json()
              if (result.success) {
                productForm.reset()
                setCreateProductOpen(false)
                fetchProducts()
              }
            } catch (error) {
              console.error('Create product error:', error)
            } finally {
              setCreatingProduct(false)
            }
          })}>
            <div className="space-y-4 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">اسم المنتج</label>
                  <Input
                    {...productForm.register('name')}
                    placeholder="اسم المنتج"
                    className="input-premium"
                  />
                  {productForm.formState.errors.name && (
                    <p className="text-xs text-destructive">{productForm.formState.errors.name.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">SKU</label>
                  <Input
                    {...productForm.register('sku')}
                    placeholder="رقم SKU"
                    className="input-premium"
                  />
                  {productForm.formState.errors.sku && (
                    <p className="text-xs text-destructive">{productForm.formState.errors.sku.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">السعر</label>
                  <Input
                    type="number"
                    step="0.01"
                    {...productForm.register('price')}
                    placeholder="0.00"
                    className="input-premium"
                  />
                  {productForm.formState.errors.price && (
                    <p className="text-xs text-destructive">{productForm.formState.errors.price.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">الكمية في المخزون</label>
                  <Input
                    type="number"
                    {...productForm.register('stock_quantity')}
                    placeholder="0"
                    className="input-premium"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">الفئة</label>
                <Input
                  {...productForm.register('category')}
                  placeholder="الفئة"
                  className="input-premium"
                />
              </div>
            </div>
            <DialogClose asChild>
              <Button variant="outline" type="button" onClick={() => setCreateProductOpen(false)} disabled={creatingProduct}>
                إلغاء
              </Button>
            </DialogClose>
            <Button type="submit" disabled={creatingProduct || !productForm.formState.isValid}>
              {creatingProduct ? 'جاري الإنشاء...' : 'إضافة المنتج'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}