import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateOrderNumber } from '@/lib/utils'
import { createOrderSchema, validateBody } from '@/lib/validation'
import type { OrderItem } from '@/types'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { isRangeNotSatisfiable } from '@/lib/supabase/paginate'
import { round2 } from '@/lib/finance'
import {
  buildOrderQuery,
  findOrderIdsByProductSearch,
  parsePagination,
  parseSort,
  ORDER_SORT_COLUMNS,
  type OrderFilters,
} from '@/lib/orders/query'
import * as XLSX from 'xlsx'

/** Read the filter set from the request (all parameters are optional). */
function readFilters(params: URLSearchParams): OrderFilters {
  return {
    search: params.get('search'),
    status: params.get('status'),
    paymentStatus: params.get('paymentStatus'),
    shippingStatus: params.get('shippingStatus'),
    customerId: params.get('customerId'),
    productId: params.get('productId'),
    dateRange: params.get('dateRange'),
    from: params.get('from') ?? params.get('dateFrom'),
    to: params.get('to') ?? params.get('dateTo'),
  }
}

export async function GET(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const searchParams = request.nextUrl.searchParams

    const pagination = parsePagination(searchParams)
    if ('error' in pagination) {
      return NextResponse.json({ error: pagination.error }, { status: 400 })
    }
    const { page, pageSize, offset } = pagination

    const { sortBy, ascending } = parseSort(searchParams)
    const filters = readFilters(searchParams)
    const exportData = searchParams.get('export') === 'true'

    // Product names live in `order_items`; PostgREST cannot mix an embedded
    // filter with a top-level `or()`, so the product branch is resolved to
    // order ids and injected into the search expression as `id.in.(...)`.
    let productMatchIds: string[] | undefined
    let productSearchTruncated = false
    if (filters.search) {
      const productHits = await findOrderIdsByProductSearch(supabase, filters.search)
      productMatchIds = productHits.ids
      productSearchTruncated = productHits.truncated
    }

    // Exports return every matching row (paginated internally so a large
    // result set cannot exhaust the response buffer).
    const { query, resolved } = await buildOrderQuery(supabase, filters, {
      count: 'exact',
      productMatchIds,
      order: [
        { column: ORDER_SORT_COLUMNS[sortBy], ascending },
        { column: 'id', ascending },
      ],
    })

    if (exportData) {
      const rows = await fetchAllRows<Record<string, any>>(
        (from, to) => query.range(from, to),
        1000
      )

      const exportDataFormatted = rows.map((order) => ({
        'رقم الطلب': order.order_number,
        'العميل': order.customer?.name || '',
        'الهاتف': order.customer?.phone || '',
        'الإجمالي': order.total_amount,
        'الحالة': order.status,
        'حالة الدفع': order.payment_status,
        'طريقة الدفع': order.payment_method,
        'رسوم الشحن': order.shipping_fee || 0,
        'الخصم': order.discount_amount || 0,
        'الضرائب': order.tax_amount || 0,
        'شركة الشحن': order.shipping_company || '',
        'رقم التتبع': order.tracking_number || '',
        'عنوان الشحن': order.shipping_address
          ? [
              order.shipping_address.address,
              order.shipping_address.city,
              order.shipping_address.governorate,
            ]
              .filter(Boolean)
              .join('، ')
          : '',
        'الملاحظات': order.notes || '',
        'المصدر': order.source || '',
        'تاريخ الإنشاء': new Date(order.created_at).toLocaleDateString('ar-EG'),
        'تاريخ التحديث': new Date(order.updated_at).toLocaleDateString('ar-EG'),
      }))

      const worksheet = XLSX.utils.json_to_sheet(exportDataFormatted, {
        header: [
          'رقم الطلب', 'العميل', 'الهاتف', 'الإجمالي', 'الحالة', 'حالة الدفع',
          'طريقة الدفع', 'رسوم الشحن', 'الخصم', 'الضرائب', 'شركة الشحن',
          'رقم التتبع', 'عنوان الشحن', 'الملاحظات', 'المصدر', 'تاريخ الإنشاء', 'تاريخ التحديث'
        ]
      })

      worksheet['!cols'] = [
        { wch: 20 }, { wch: 25 }, { wch: 18 }, { wch: 15 }, { wch: 18 }, { wch: 15 },
        { wch: 15 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 20 }, { wch: 20 },
        { wch: 40 }, { wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
      ]

      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'الطلبات')
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="orders-${new Date().toISOString().split('T')[0]}.xlsx"`,
        },
      })
    }

    const { data, error, count } = await query.range(offset, offset + pageSize - 1)
    if (error) {
      // PGRST103: the page starts past the last row — an empty page, not a
      // server error. Answer 200 with the real total so the pager can show
      // "you are past the end" instead of a 500.
      if (isRangeNotSatisfiable(error)) {
        const countOnly = await buildOrderQuery(supabase, filters, {
          count: 'exact',
          productMatchIds,
          order: [{ column: 'id', ascending: true }],
        })
        const { count: totalCount } = await countOnly.query.select('id', { count: 'exact', head: true })
        return NextResponse.json({
          data: [],
          total: totalCount ?? 0,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil((totalCount ?? 0) / pageSize)),
          dateRange: resolved.dateRange,
          productSearchTruncated,
          appliedFilters: {
            search: resolved.search,
            status: resolved.status,
            paymentStatus: resolved.paymentStatus,
            shippingStatuses: resolved.shippingStatuses,
            customerId: resolved.customerId,
            productId: resolved.productId,
          },
        })
      }
      throw error
    }

    const total = count ?? 0
    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    return NextResponse.json({
      data: data || [],
      total,
      page,
      pageSize,
      totalPages,
      // The resolved range so the UI can display exactly what was filtered.
      dateRange: resolved.dateRange,
      productSearchTruncated,
      appliedFilters: {
        search: resolved.search,
        status: resolved.status,
        paymentStatus: resolved.paymentStatus,
        shippingStatuses: resolved.shippingStatuses,
        customerId: resolved.customerId,
        productId: resolved.productId,
      },
    })
  } catch (error) {
    console.error('Get orders error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch orders' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  // Authentication: verify the caller's JWT with Supabase Auth
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth

  const validation = await validateBody(request, createOrderSchema)
  if (validation.error) return validation.error

  const { data, error: validationError } = validation
  if (validationError) return validationError

  try {
    const supabase = createServiceClient()
    const { 
      customer_id, 
      items, 
      shipping_address, 
      billing_address,
      payment_method = 'cash_on_delivery',
      shipping_fee = 0,
      discount_amount = 0,
      tax_amount = 0,
      notes,
      source = 'manual',
    } = data

    // Validate inventory + capture the current unit cost snapshot per line
    const unitCostById: Record<string, number> = {}
    for (const item of items) {
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('stock_quantity, track_inventory, name, cost_price')
        .eq('id', item.product_id)
        .single()

      if (productError) {
        return NextResponse.json(
          { error: `Product not found: ${item.product_id}` },
          { status: 400 }
        )
      }

      if (product?.track_inventory && product.stock_quantity < item.quantity) {
        return NextResponse.json(
          { error: `Insufficient stock for product ${product.name}. Available: ${product.stock_quantity}, Requested: ${item.quantity}` },
          { status: 400 }
        )
      }
      unitCostById[item.product_id] = product?.cost_price ?? 0
    }

    // Derive every line total from the line's OWN numbers.
    //
    // The client used to send `total_price` and the route stored it as-is,
    // so an order could carry a 500 EGP item with a line total of 1 EGP —
    // and revenue, the dashboard, the payouts and every customer's
    // total_spent are computed from these stored columns. The line total is
    // now DERIVED, never trusted, so the books always add up.
    const pricedItems = items.map((item) => ({
      ...item,
      total_price: round2(
        Math.max(0, item.unit_price * item.quantity - (item.discount || 0))
      ),
    }))

    // Calculate totals
    const subtotal = round2(
      pricedItems.reduce(
        (sum: number, item: { total_price: number }) => sum + item.total_price,
        0
      )
    )
    // The order-level discount cannot exceed the subtotal: otherwise the
    // stored total turns negative and every report inherits the error.
    const cappedDiscount = Math.min(discount_amount, subtotal)
    const total_amount = round2(subtotal - cappedDiscount + shipping_fee + tax_amount)

    // Create order
    const order_number = generateOrderNumber()
    
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number,
        customer_id,
        status: 'pending',
        payment_status: 'pending',
        payment_method,
        subtotal,
        discount_amount: cappedDiscount,
        shipping_fee,
        tax_amount,
        total_amount,
        items: pricedItems.map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          product_name: item.product_name,
          product_name_ar: item.product_name_ar,
          sku: item.sku,
          variant_name: item.variant_name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          unit_cost: unitCostById[item.product_id] ?? 0,
          discount: item.discount || 0,
          total_price: item.total_price,
        })),
        shipping_address,
        billing_address,
        notes,
        source,
      })
      .select()
      .single()

    if (orderError) throw orderError

    // Create order items
    const orderItems = pricedItems.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      variant_id: item.variant_id,
      product_name: item.product_name,
      product_name_ar: item.product_name_ar,
      sku: item.sku,
      variant_name: item.variant_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      unit_cost: unitCostById[item.product_id] ?? 0,
      discount: item.discount || 0,
      total_price: item.total_price,
    }))

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems)

    if (itemsError) throw itemsError

    // Log automation
    await supabase.from('automation_logs').insert({
      type: 'order_created',
      status: 'success',
      reference_id: order.id,
      reference_type: 'order',
      details: { order_number, customer_id, item_count: items.length },
    })

    // Notify staff — user_id comes from the verified JWT (service client's
    // auth.getUser() always returns null, so use requireUser's result)
    await supabase.from('notifications').insert({
      user_id: auth.user.id,
      type: 'new_order',
      title: 'طلب جديد',
      message: `تم إنشاء طلب جديد ${order_number}`,
      reference_id: order.id,
      reference_type: 'order',
    })

    return NextResponse.json({ success: true, data: order })
  } catch (error) {
    console.error('Create order error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create order' },
      { status: 500 }
    )
  }
}
