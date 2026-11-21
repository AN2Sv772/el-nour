"use client"

import * as React from "react"
import { use, useState, useEffect } from "react"
import Link from "next/link"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { PageHeader } from '@/components/shell/page-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowRight, Box, Tag, DollarSign, ArrowLeft, Truck, X } from "lucide-react"
import { formatCurrency, formatDate, cn } from "@/lib/utils"
import type { Product } from "@/types"

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/products?id=${encodeURIComponent(id)}`, { credentials: 'include' })
        if (!res.ok) throw new Error('تعذر تحميل المنتج')
        const body = await res.json()
        const found = (body.data || [])[0]
        if (!found) throw new Error('لم يتم العثور على المنتج')
        if (cancelled) return
        setProduct(found)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'حدث خطأ')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-4xl">
        {/* Header */}
        <PageHeader
          leading={
            <Link
              href="/products"
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="عودة للمنتجات"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
          }
          title={product?.name || '...'}
          description={
            product ? (
              <span className="flex items-center gap-2">
                <span className="font-mono" dir="ltr">{product.sku}</span>
                {product.category && <span>{product.category}</span>}
              </span>
            ) : undefined
          }
        />

        {error && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/8 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        ) : product ? (
          <>
            {/* Main info */}
            <Card className="rounded-2xl border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Box className="h-4 w-4 text-muted-foreground" />
                  معلومات المنتج
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-[13px] font-medium text-muted-foreground">الاسم (عربي)</p>
                    <p className="text-foreground">{product.name_ar || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-muted-foreground">الاسم (إنجليزي)</p>
                    <p className="text-foreground dir-ltr">{product.name_ar || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-muted-foreground">المعرف / SKU</p>
                    <p className="font-mono text-foreground dir-ltr">{product.sku}</p>
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-muted-foreground">الصنف / الفئة</p>
                    <p className="text-foreground">{product.category || '—'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Pricing & Stock */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="rounded-2xl border-border">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-medium text-muted-foreground">السعر</p>
                    <DollarSign className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">{formatCurrency(product.price)}</p>
                  {product.compare_at_price && product.compare_at_price > product.price && (
                    <p className="text-sm text-destructive line-through mt-1">
                      {formatCurrency(product.compare_at_price)}
                    </p>
                  )}
                </CardContent>
              </Card>
              {product.cost_price !== null && product.cost_price !== undefined && (
                <Card className="rounded-2xl border-border">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[13px] font-medium text-muted-foreground">التكلفة</p>
                      <DollarSign className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{formatCurrency(product.cost_price)}</p>
                  </CardContent>
                </Card>
              )}
              <Card className="rounded-2xl border-border">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-medium text-muted-foreground">المخزون</p>
                    <Truck className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
                  </div>
                  <p className={`text-2xl font-bold ${product.track_inventory && product.stock_quantity <= (product.low_stock_threshold || 5) ? 'text-destructive' : 'text-foreground'}`}>
                    {product.track_inventory ? product.stock_quantity : 'غير مُتتبَّع'}
                  </p>
                  {product.track_inventory && product.low_stock_threshold && (
                    <p className="text-xs text-muted-foreground mt-1">
                      حد التنبيه: {product.low_stock_threshold}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Variants */}
            {(product.variants && product.variants.length > 0) && (
              <Card className="rounded-2xl border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    المتغيرات
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="rounded-xl border border-border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/40 text-xs text-muted-foreground">
                          <th className="text-right font-medium px-3 py-2">الاسم</th>
                          <th className="text-center font-medium px-3 py-2">SKU</th>
                          <th className="text-center font-medium px-3 py-2">السعر</th>
                          <th className="text-center font-medium px-3 py-2">المخزون</th>
                          <th className="text-right font-medium px-3 py-2">الخصائص</th>
                        </tr>
                      </thead>
                      <tbody>
                        {product.variants.map((v) => (
                          <tr key={v.id} className="border-t border-border/40">
                            <td className="px-3 py-2.5 font-medium">{v.name}</td>
                            <td className="px-3 py-2.5 text-center font-mono text-xs dir-ltr">{v.sku}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums">{formatCurrency(v.price)}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums">{v.stock_quantity ?? '—'}</td>
                            <td className="px-3 py-2.5 text-right">
                              {v.attributes && Object.entries(v.attributes).map(([vpKey, vpValue]) => (
                                <span key={vpKey} className="inline-block bg-muted rounded px-2 py-0.5 text-[11px] mr-1 mb-1">
                                  {vpKey}: {vpValue}
                                </span>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Description */}
            {product.description && (
              <Card className="rounded-2xl border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold">الوصف</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm whitespace-pre-wrap text-muted-foreground">
                  {product.description}
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Link href={`/products/${product.id}/edit`}>
                <Button variant="outline">
                  <X className="h-4 w-4 mr-2" />
                  تعديل
                </Button>
              </Link>
              <Link href="/products">
                <Button variant="ghost">
                  <ArrowRight className="h-4 w-4 mr-2" />
                  العودة
                </Button>
              </Link>
            </div>
          </>
        ) : (
          <Card className="rounded-2xl border-border">
            <CardContent className="py-12 text-center text-muted-foreground">
              لم يتم العثور على المنتج
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  )
}