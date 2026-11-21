/**
 * The server side of the intelligence engines.
 *
 * It reads the REAL rows (orders, customers, items) and hands them to the
 * pure engines in `risk.ts`, `anomaly.ts`, `forecast.ts`, `simulator.ts` and
 * `briefing.ts`. Like the metrics engine, it never computes a business
 * figure itself — it only fetches and shapes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { businessDateString, resolveDateRange, BUSINESS_TIME_ZONE } from '@/lib/date-range'
import { normalizePreset } from '@/lib/metrics/engine'
import type { RiskOrder } from './risk'

type Db = SupabaseClient

export interface OrderWithCustomer extends RiskOrder {
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  customer_city: string | null
  customer_governorate: string | null
  customer_address: string | null
  items: { product_id: string | null; name: string | null; quantity: number | null }[]
  /** Resolved outcome flags, derived from the order status. */
  delivered: boolean
  returned: boolean
  refused: boolean
  cancelled: boolean
}

/** Fetch the orders of a window with their customer and their items. */
export async function fetchOrdersWithCustomers(
  db: Db,
  from: string | null,
  to: string | null,
  options: { limit?: number } = {}
): Promise<OrderWithCustomer[]> {
  let q = db
    .from('orders')
    .select(
      'id, order_number, customer_id, total_amount, status, payment_status, created_at, source, shipping_fee, shipping_address, items',
    )
  if (from) q = q.gte('created_at', from)
  if (to) q = q.lte('created_at', to)
  q = q.order('id', { ascending: true })

  const rows = await fetchAllRows<any>((f, t) => q.range(f, t))
  const limited = options.limit ? rows.slice(0, options.limit) : rows

  // Customers — one query, then a map.
  const customerIds = [...new Set(limited.map(o => o.customer_id).filter(Boolean))] as string[]
  const customers = new Map<string, any>()
  if (customerIds.length > 0) {
    const { data } = await db
      .from('customers')
      .select('id, phone, name, city, governorate, address')
      .in('id', customerIds)
    for (const c of data ?? []) customers.set(c.id, c)
  }

  return limited.map(o => {
    const customer = o.customer_id ? customers.get(o.customer_id) : null
    const shipping = (o.shipping_address ?? {}) as Record<string, any>
    const status = String(o.status ?? '').toLowerCase()
    const items = Array.isArray(o.items)
      ? (o.items as any[]).map(i => ({
          product_id: i.product_id ?? i.productId ?? null,
          name: i.name ?? i.product_name ?? null,
          quantity: i.quantity ?? i.qty ?? null,
        }))
      : []
    return {
      id: o.id,
      orderNumber: o.order_number ?? null,
      customerId: o.customer_id ?? null,
      customer_id: o.customer_id ?? null,
      customer_name: customer?.name ?? null,
      customer_phone: customer?.phone ?? null,
      customer_city: customer?.city ?? shipping.city ?? null,
      customer_governorate: customer?.governorate ?? shipping.governorate ?? null,
      customer_address: customer?.address ?? shipping.address ?? null,
      totalAmount: Number(o.total_amount ?? 0),
      createdAt: o.created_at,
      status: o.status ?? 'pending',
      paymentStatus: o.payment_status ?? null,
      phone: customer?.phone ?? null,
      city: customer?.city ?? shipping.city ?? null,
      governorate: customer?.governorate ?? shipping.governorate ?? null,
      address: customer?.address ?? shipping.address ?? null,
      source: o.source ?? null,
      items,
      delivered: status === 'delivered',
      returned: status === 'returned',
      refused: status === 'returned' || status === 'refused',
      cancelled: status === 'cancelled',
    }
  })
}

/** Resolve a window the same way every other module does. */
export function resolveWindow(
  options: { dateRange?: string | null; from?: string | null; to?: string | null },
  now: Date = new Date()
) {
  const hasCustom = Boolean(options.from || options.to)
  const preset = normalizePreset(options.dateRange, hasCustom)
  return resolveDateRange(
    { dateRange: preset, from: options.from, to: options.to },
    now
  )
}

/** The Cairo business day of a date. */
export function cairoDay(date: Date | string): string {
  return businessDateString(typeof date === 'string' ? new Date(date) : date, BUSINESS_TIME_ZONE)
}
