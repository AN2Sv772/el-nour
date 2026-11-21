import { NextRequest, NextResponse } from 'next/server'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'
import { parseBoundedInt, parseDateParam, DEFAULT_TOP_LIMIT, MAX_TOP_LIMIT } from '@/lib/api-params'

interface ProductWithRelations {
  name: string
  name_ar: string | null
  sku: string
}

interface OrderItemWithProduct {
  product_id: string
  quantity: number
  total_price: number
  product: ProductWithRelations[]
}

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const searchParams = request.nextUrl.searchParams

    // A `limit` of -1 or 999999 used to be accepted and returned the whole
    // aggregated catalogue. The limit is now bounded (1…100).
    const limit = parseBoundedInt(searchParams.get('limit'), {
      min: 1,
      max: MAX_TOP_LIMIT,
      defaultValue: DEFAULT_TOP_LIMIT,
      label: 'الحد الأقصى',
    })
    if (!limit.ok) {
      return NextResponse.json({ error: limit.error }, { status: 400 })
    }

    const dateFrom = parseDateParam(searchParams.get('dateFrom'), 'تاريخ البداية')
    if (!dateFrom.ok) {
      return NextResponse.json({ error: dateFrom.error }, { status: 400 })
    }
    const dateTo = parseDateParam(searchParams.get('dateTo'), 'تاريخ النهاية')
    if (!dateTo.ok) {
      return NextResponse.json({ error: dateTo.error }, { status: 400 })
    }

    let query = supabase
      .from('order_items')
      .select(`
        product_id,
        quantity,
        total_price,
        created_at:orders(created_at),
        product:products!inner(name, name_ar, sku)
      `)

    // order_items has NO created_at column — filter via the parent order
    if (dateFrom.value) query = query.gte('orders.created_at', dateFrom.value)
    if (dateTo.value) query = query.lte('orders.created_at', dateTo.value)

    // Paginated: PostgREST returns at most 1000 rows per response, which
    // silently truncated the aggregation once the store grew past 1000
    // line items.
    const items = await fetchAllRows<{
      product_id: string
      quantity: number | null
      total_price: number | null
      product: ProductWithRelations | ProductWithRelations[] | null
    }>((from, to) => query.order('id', { ascending: true }).range(from, to))

    // Aggregate by product
    const productStats: Record<string, { name: string; name_ar: string | null; sku: string; sales: number; revenue: number }> = {}

    for (const item of items) {
      const productId = item.product_id
      // supabase returns object (single FK) or array depending on relationship
      const raw = item.product as ProductWithRelations | ProductWithRelations[] | null
      const productData = Array.isArray(raw) ? raw[0] : raw
      if (!productStats[item.product_id]) {
        productStats[item.product_id] = {
          name: productData?.name ?? 'منتج غير معروف',
          name_ar: productData?.name_ar ?? null,
          sku: productData?.sku ?? '',
          sales: 0,
          revenue: 0,
        }
      }
      productStats[item.product_id].sales += item.quantity ?? 0
      productStats[item.product_id].revenue += item.total_price ?? 0
    }

    // Sort by sales and take top N
    const topProducts = Object.entries(productStats)
      .sort(([, a], [, b]) => b.sales - a.sales)
      .slice(0, limit.value)
      .map(([id, stats]) => ({ id, ...stats }))

    return NextResponse.json({ data: topProducts })
  } catch (error) {
    console.error('Top products error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch top products' },
      { status: 500 }
    )
  }
}