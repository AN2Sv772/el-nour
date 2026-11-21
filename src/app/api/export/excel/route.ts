import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/require-role'
import { formatDate, formatPhoneNumber } from '@/lib/utils'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { resolveDateRange, businessDateString } from '@/lib/date-range'
import type { Order, Customer, Product, OrderItem } from '@/types'

const statusColors: Record<string, { text: string }> = {
  pending: { text: 'قيد الانتظار' },
  awaiting_confirmation: { text: 'بانتظار التأكيد' },
  confirmed: { text: 'مؤكد' },
  preparing: { text: 'قيد التجهيز' },
  ready_for_shipping: { text: 'جاهز للشحن' },
  shipped: { text: 'تم الشحن' },
  out_for_delivery: { text: 'قيد التوصيل' },
  delivered: { text: 'تم التسليم' },
  cancelled: { text: 'ملغي' },
  returned: { text: 'مرتجع' },
  failed_delivery: { text: 'فشل التوصيل' },
}

export async function POST(request: NextRequest) {
  // An export contains customer names, phone numbers and addresses — it
  // requires an authenticated employee at minimum.
  const auth = await requireRole('employee')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  try {
    // Create server-side Supabase client that respects RLS
    const supabase = await createClient()

    const body = await request.json()
    const { type, filters = {}, columns = [], format = 'xlsx' } = body

    // ── Date range (F-017) ────────────────────────────────────────────────
    // ONE range for every branch of the export, resolved by the shared
    // Africa/Cairo engine. The export used to compare the raw filter strings
    // (`2026-11-01` → `2026-11-01T00:00:00Z`) while the orders list used the
    // Cairo day boundaries (`2026-10-31T22:00:00Z` …), so the export missed
    // the orders created in the first two hours of the first day (503 rows
    // exported vs 506 listed).
    const rawFrom = normalizeExportDate(filters.dateFrom)
    const rawTo = normalizeExportDate(filters.dateTo)
    if (rawFrom === null || rawTo === null) {
      // Fail CLOSED: an unparseable bound must not widen the export to
      // "everything".
      return NextResponse.json({ error: 'invalid_date_range' }, { status: 400 })
    }
    const exportRange = resolveDateRange({ dateFrom: rawFrom, dateTo: rawTo })

    let data: Record<string, unknown>[] = []
    let headers: string[] = []
    let filename = 'export'

    switch (type) {
      case 'orders': {
        let query = supabase
          .from('orders')
          .select(`
            *,
            customer:customers(*),
            items:order_items(*)
          `)

        if (filters.status) query = query.eq('status', filters.status)
        if (filters.customerId) query = query.eq('customer_id', filters.customerId)
        if (exportRange.from) query = query.gte('created_at', exportRange.from)
        if (exportRange.to) query = query.lte('created_at', exportRange.to)
        // Explicit selection (bulk export) — filters.dateFrom/dateTo also applied
        if (Array.isArray(filters.orderIds) && filters.orderIds.length > 0) {
          query = query.in('id', filters.orderIds.slice(0, 200))
        }

        // Paginated: PostgREST returns at most 1000 rows per response.
        const orders = await fetchAllRows<Order & { customer?: Customer; items?: OrderItem[] }>(
          (from, to) => query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)
        )

        data = orders.map((order: Order) => ({
          'رقم الطلب': order.order_number,
          'تاريخ الطلب': formatDate(order.created_at),
          'اسم العميل': order.customer?.name || '',
          'رقم واتساب': order.customer?.phone ? order.customer.phone.replace(/\D/g, '') : '',
          'هاتف العميل': order.customer?.phone ? formatPhoneNumber(order.customer.phone) : '',
          'عنوان التسليم': `${order.shipping_address?.address || ''}, ${order.shipping_address?.city || ''}, ${order.shipping_address?.governorate || ''}`,
          'الحالة': statusColors[order.status]?.text || order.status,
          'حالة الدفع': order.payment_status,
          'طريقة الدفع': order.payment_method,
          'المبلغ الفرعي': order.subtotal,
          'الخصم': order.discount_amount,
          'رسوم الشحن': order.shipping_fee,
          'الضريبة': order.tax_amount,
          'الإجمالي': order.total_amount,
          'شركة الشحن': order.shipping_company || '',
          'رقم التتبع': order.tracking_number || '',
          'المصدر': order.source || '',
          'ملاحظات': order.notes || '',
          'ملاحظات داخلية': order.internal_notes || '',
        }))
        headers = [
          'رقم الطلب', 'تاريخ الطلب', 'اسم العميل', 'هاتف العميل', 'عنوان التسليم',
          'الحالة', 'حالة الدفع', 'طريقة الدفع', 'المبلغ الفرعي', 'الخصم',
          'رسوم الشحن', 'الضريبة', 'الإجمالي', 'شركة الشحن', 'رقم التتبع',
          'المصدر', 'ملاحظات', 'ملاحظات داخلية'
        ]
        filename = `orders_${formatDate(new Date()).replace(/\s/g, '_')}`
        break
      }

      case 'order_items': {
        let query = supabase
          .from('order_items')
          .select(`
            *,
            order:orders(order_number, created_at, customer:customers(name, phone)),
            product:products(name, name_ar, sku)
          `)

        // Same Cairo-day bounds as the orders export (F-017).
        if (exportRange.from) query = query.gte('orders.created_at', exportRange.from)
        if (exportRange.to) query = query.lte('orders.created_at', exportRange.to)

        // PostgREST embedded ordering uses the relationship name with the
        // column in parens: orders(created_at)
        // Paginated: PostgREST returns at most 1000 rows per response.
        const items = await fetchAllRows<OrderItem & { order?: { order_number: string; created_at: string; customer?: { name: string; phone: string } }; product?: { name: string; name_ar: string | null; sku: string } }>(
          // The embed is ALIASED as `order:`, so PostgREST requires
          // `order(created_at)` here — `orders(created_at)` fails with
          // PGRST108 ("not an embedded resource"), which is why this export
          // used to return HTTP 500.
          (from, to) => query.order('order(created_at)', { ascending: false }).order('id', { ascending: false }).range(from, to)
        )

        data = items.map((item: OrderItem & { order?: { order_number: string; created_at: string; customer?: { name: string; phone: string } }; product?: { name: string; name_ar: string | null; sku: string } }) => ({
          'رقم الطلب': item.order?.order_number,
          'تاريخ الطلب': item.order?.created_at ? formatDate(item.order.created_at) : '',
          'اسم العميل': item.order?.customer?.name || '',
          'هاتف العميل': item.order?.customer?.phone ? formatPhoneNumber(item.order.customer.phone) : '',
          'اسم المنتج': item.product_name_ar || item.product_name,
          'SKU': item.sku,
          'النمط': item.variant_name || '',
          'الكمية': item.quantity,
          'سعر الوحدة': item.unit_price,
          'الخصم': item.discount,
          'الإجمالي': item.total_price,
        }))
        headers = [
          'رقم الطلب', 'تاريخ الطلب', 'اسم العميل', 'هاتف العميل',
          'اسم المنتج', 'SKU', 'النمط', 'الكمية', 'سعر الوحدة', 'الخصم', 'الإجمالي'
        ]
        filename = `order_items_${formatDate(new Date()).replace(/\s/g, '_')}`
        break
      }

      case 'customers': {
        let query = supabase.from('customers').select('*')
        if (filters.search) {
          query = query.or(`name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%,email.ilike.%${filters.search}%`)
        }

        // Paginated: PostgREST returns at most 1000 rows per response.
        const customers = await fetchAllRows<Customer>(
          (from, to) => query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)
        )

        data = customers.map((customer: Customer) => ({
          'الاسم': customer.name || '',
          'الهاتف': formatPhoneNumber(customer.phone),
          'البريد الإلكتروني': customer.email || '',
          'العنوان': customer.address || '',
          'المدينة': customer.city || '',
          'المحافظة': customer.governorate || '',
          'الرمز البريدي': '',
          'إجمالي الطلبات': customer.total_orders,
          'إجمالي الإنفاق': customer.total_spent,
          'آخر تفاعل': customer.last_interaction_at ? formatDate(customer.last_interaction_at) : '',
          'تاريخ الإنشاء': formatDate(customer.created_at),
          'الوسوم': customer.tags?.join(', ') || '',
          'ملاحظات': customer.notes || '',
        }))
        headers = [
          'الاسم', 'الهاتف', 'البريد الإلكتروني', 'العنوان', 'المدينة',
          'المحافظة', 'الرمز البريدي', 'إجمالي الطلبات', 'إجمالي الإنفاق',
          'آخر تفاعل', 'تاريخ الإنشاء', 'الوسوم', 'ملاحظات'
        ]
        filename = `customers_${formatDate(new Date()).replace(/\s/g, '_')}`
        break
      }

      case 'products': {
        let query = supabase.from('products').select('*').eq('is_active', true)
        if (filters.category) query = query.eq('category', filters.category)

        // Paginated: PostgREST returns at most 1000 rows per response.
        const products = await fetchAllRows<Product>(
          (from, to) => query.order('name', { ascending: true }).order('id', { ascending: true }).range(from, to)
        )

        data = products.map((product: Product) => ({
          'اسم المنتج': product.name,
          'اسم المنتج (عربي)': product.name_ar || '',
          'SKU': product.sku,
          'الفئة': product.category || '',
          'السعر': product.price,
          'سعر المقارنة': product.compare_at_price || '',
          'التكلفة': product.cost_price || '',
          'المخزون': product.track_inventory ? product.stock_quantity : 'غير مُتتبع',
          'حد التنبيه': product.low_stock_threshold,
          'الوصف': product.description || '',
          'الوصف (عربي)': product.description_ar || '',
          'نشط': product.is_active ? 'نعم' : 'لا',
          'تاريخ الإنشاء': formatDate(product.created_at),
        }))
        headers = [
          'اسم المنتج', 'اسم المنتج (عربي)', 'SKU', 'الفئة', 'السعر',
          'سعر المقارنة', 'التكلفة', 'المخزون', 'حد التنبيه',
          'الوصف', 'الوصف (عربي)', 'نشط', 'تاريخ الإنشاء'
        ]
        filename = `products_${formatDate(new Date()).replace(/\s/g, '_')}`
        break
      }

      case 'sales': {
        const buildQuery = (from: number, to: number) => {
          let query = supabase
            .from('orders')
            .select('created_at, total_amount, status, payment_status')
            .in('status', ['delivered', 'shipped', 'confirmed'])
            .order('id', { ascending: true })
            .range(from, to)

          if (exportRange.from) query = query.gte('created_at', exportRange.from)
          if (exportRange.to) query = query.lte('created_at', exportRange.to)
          return query
        }

        // Paginated: PostgREST returns at most 1000 rows per response, so a
        // single .select() silently truncated the financial export.
        const orders = await fetchAllRows<{ created_at: string; total_amount: number | null; status: string; payment_status: string }>(buildQuery)

        const salesByDate: Record<string, { orders: number; revenue: number }> = {}
        for (const order of orders) {
          const date = formatDate(order.created_at)
          if (!salesByDate[date]) {
            salesByDate[date] = { orders: 0, revenue: 0 }
          }
          salesByDate[date].orders++
          salesByDate[date].revenue += order.total_amount ?? 0
        }

        data = Object.entries(salesByDate).map(([date, stats]) => ({
          'التاريخ': date,
          'عدد الطلبات': stats.orders,
          'إجمالي المبيعات': stats.revenue,
        }))
        headers = ['التاريخ', 'عدد الطلبات', 'إجمالي المبيعات']
        filename = `sales_report_${formatDate(new Date()).replace(/\s/g, '_')}`
        break
      }

      default:
        return NextResponse.json({ error: 'Invalid export type' }, { status: 400 })
    }

    let finalData = data
    let finalHeaders = headers
    if (columns.length > 0) {
      finalHeaders = columns.filter((c: string) => headers.includes(c))
      finalData = data.map((row) => {
        const filtered: Record<string, unknown> = {}
        finalHeaders.forEach((h) => { filtered[h] = row[h] })
        return filtered
      })
    }

    // Enhanced formula injection protection
    // For XLSX: we set all cells as text type ('s') to prevent formula execution
    // For CSV: we sanitize and rely on proper escaping
    function sanitizeCellValue(cell: unknown): string {
      if (typeof cell !== 'string') {
        return cell == null ? '' : String(cell)
      }
      
      // Remove control characters that could be used in CSV injection
      // Includes: null, vertical tab, form feed, tab, LF, CR, and other control chars
      const sanitized = cell.replace(/[\x00-\x1F\x7F]/g, '')
      
      // Check for formula injection patterns on the trimmed version
      // but apply protection to the full sanitized value
      const trimmed = sanitized.trimStart()
      if (trimmed === '') return sanitized
      
      // Formula prefixes that trigger execution in spreadsheet applications
      const formulaPrefixes = ['=', '+', '-', '@']
      const hasFormulaPrefix = formulaPrefixes.some(prefix => trimmed.startsWith(prefix))
      
      // DDE attack patterns (e.g., =cmd|' /C calc'!A0)
      const ddePattern = /^=.*[|!].*$/i
      const isDdeAttack = ddePattern.test(trimmed)
      
      // Hyperlink formulas: =HYPERLINK("http://evil.com", "Click me")
      const hyperlinkPattern = /^=HYPERLINK\s*\(/i
      const isHyperlinkAttack = hyperlinkPattern.test(trimmed)
      
      // External workbook references: ='[workbook.xlsx]Sheet1'!A1
      const externalRefPattern = /^=.*\[.*\].*!/i
      const isExternalRef = externalRefPattern.test(trimmed)
      
      if (hasFormulaPrefix || isDdeAttack || isHyperlinkAttack || isExternalRef) {
        // Prepend single quote to neutralize formula interpretation
        // This works for XLSX when cell type is text, and for CSV when opened in Excel
        // For CSV, the quote becomes part of the cell value
        return "'" + sanitized
      }
      
      return sanitized
    }

    const wb = XLSX.utils.book_new()
    
    const wsData = [finalHeaders, ...finalData.map(row => finalHeaders.map(h => row[h]))]
    
    // Apply comprehensive sanitization to all cells
    const protectedWsData = wsData.map(row => 
      row.map(cell => sanitizeCellValue(cell))
    )

    // Create worksheet with all cells explicitly typed as text ('s') to prevent formula execution
    const ws = XLSX.utils.aoa_to_sheet(protectedWsData)
    
    // Force all cells to be text type to prevent formula execution in XLSX
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    for (let R = range.s.r; R <= range.e.r; ++R) {
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const cellRef = XLSX.utils.encode_cell({ r: R, c: C })
        if (ws[cellRef]) {
          ws[cellRef].t = 's' // Force string type
        }
      }
    }
    
    const colWidths = finalHeaders.map(h => ({ wch: Math.max(h.length, 15) }))
    ws['!cols'] = colWidths

    XLSX.utils.book_append_sheet(wb, ws, 'بيانات')

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: format })

    await supabase.from('export_jobs').insert({
      user_id: user.id,
      type,
      format,
      status: 'completed',
      filters,
      columns: finalHeaders,
      row_count: finalData.length,
      file_url: '',
    })

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': format === 'xlsx' 
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv',
        // ASCII-only filename (HTTP headers are ByteString); UTF-8 name via
        // filename* for the Arabic-friendly download name.
        'Content-Disposition': `attachment; filename="${filename.replace(/[^\x20-\x7E]/g, '_')}.${format}"; filename*=UTF-8''${encodeURIComponent(filename)}.${format}`,
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    )
  }
}

/**
 * Normalise one export date filter to a Cairo business day (`YYYY-MM-DD`).
 *
 * Returns:
 *   undefined — no filter was supplied
 *   null      — a filter WAS supplied but cannot be parsed (fail closed)
 *   'YYYY-MM-DD' — the business day the value belongs to
 *
 * A full ISO instant is mapped to the Cairo day that contains it, so the
 * export can never silently widen to "every order" because the caller used
 * a timestamp instead of a date.
 */
function normalizeExportDate(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return undefined
  const raw = String(value).trim()
  if (!raw) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const probe = new Date(`${raw}T00:00:00Z`)
    return Number.isNaN(probe.getTime()) ? null : raw
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return businessDateString(parsed)
}
