import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveDateRange, type ResolvedDateRange } from '@/lib/date-range'
import { sanitizeSearchTerm } from '@/lib/api-params'
import { fetchAllRows } from '@/lib/supabase/paginate'

/**
 * A single, shared filtering layer for EVERYTHING that reads orders:
 * the orders list, the orders statistics, the dashboard counters, the sales
 * chart and the exports.
 *
 * Why this exists (root cause of the historical inconsistencies):
 *
 *  - `/api/orders` read `dateFrom` / `dateTo` while `/api/dashboard/stats`
 *    read `dateRange` / `from` / `to`. The orders page sent `dateRange`, the
 *    orders API ignored it, so the table showed every order while the
 *    counters showed the selected range.
 *  - The orders API capped customer matches at 200 ids, so search silently
 *    dropped results past the 200th matching customer.
 *  - The orders API interpolated the raw search string into a PostgREST
 *    `.or()` expression, so a comma or parenthesis in the search box
 *    changed the query (or produced a 500).
 *  - The stats API and the orders API computed "the same" range differently
 *    (local-time calendar maths in two places), so midnight-boundary orders
 *    landed in different buckets.
 *
 * Everything now resolves through one builder, so the table, the counters
 * and the export always describe the same set of records.
 */

export interface OrderFilters {
  /** Free text: order id, order number, customer name, phone, tracking number. */
  search?: string | null
  /** Order status (exact). */
  status?: string | null
  /** Payment status (exact). */
  paymentStatus?: string | null
  /** Shipping phase (a group of order statuses). */
  shippingStatus?: string | null
  customerId?: string | null
  /** Product id — filters to orders containing that product. */
  productId?: string | null
  /** Preset id, e.g. `today`. */
  dateRange?: string | null
  /** Custom inclusive start date, `YYYY-MM-DD`. */
  from?: string | null
  /** Custom inclusive end date, `YYYY-MM-DD`. */
  to?: string | null
}

export interface OrderQueryOptions {
  /** Columns to select. Defaults to the list projection. */
  select?: string
  /** Order ids whose product names match the search term (see findOrderIdsByProductSearch). */
  productMatchIds?: string[]
  /** `exact` returns the total number of matching rows. */
  count?: 'exact' | 'planned' | 'estimated'
  /** Row range. Omit for "no pagination" (used by exports). */
  range?: { from: number; to: number }
  /** Extra PostgREST ordering applied after the primary sort. */
  order?: { column: string; ascending: boolean }[]
}

/** Columns the list UI needs — no `internal_notes`, no billing address. */
export const ORDER_LIST_SELECT = `
  id,
  order_number,
  status,
  payment_status,
  payment_method,
  subtotal,
  discount_amount,
  shipping_fee,
  tax_amount,
  total_amount,
  source,
  created_at,
  updated_at,
  customer_id,
  tracking_number,
  shipping_company,
  customer:customers(id, name, phone, governorate, city),
  items:order_items(id, product_id, product_name, variant_name, sku, quantity, unit_price, discount, total_price)
`

/** Every order status in the database enum. */
export const ORDER_STATUSES = [
  'pending',
  'awaiting_confirmation',
  'confirmed',
  'preparing',
  'ready_for_shipping',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'returned',
  'failed_delivery',
] as const

export const PAYMENT_STATUSES = ['pending', 'paid', 'partial', 'refunded', 'failed'] as const

/** Shipping phases, expressed as groups of order statuses. */
export const SHIPPING_STATUS_GROUPS: Record<string, string[]> = {
  not_shipped: ['pending', 'awaiting_confirmation', 'confirmed', 'preparing', 'ready_for_shipping'],
  in_transit: ['shipped', 'out_for_delivery'],
  delivered: ['delivered'],
  failed: ['failed_delivery'],
  returned: ['returned'],
  cancelled: ['cancelled'],
}

/** Sortable columns — an explicit allow-list prevents 500s from bad input. */
export const ORDER_SORT_COLUMNS = {
  created_at: 'created_at',
  updated_at: 'updated_at',
  total_amount: 'total_amount',
  subtotal: 'subtotal',
  order_number: 'order_number',
  status: 'status',
  payment_status: 'payment_status',
} as const

export type OrderSortKey = keyof typeof ORDER_SORT_COLUMNS

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Strip PostgREST filter metacharacters from a value used in an EMBEDDED
 * filter.
 *
 * PostgREST only strips double quotes for top-level filters; inside an
 * embedded filter (`items.product_name=ilike."%x%"`) the quotes are kept
 * literally and the pattern never matches. Embedded filters therefore use
 * an unquoted, sanitised value.
 */
export function sanitizeEmbeddedValue(value: string): string {
  return value.replace(/[,()*.:"\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Escape a value for a top-level PostgREST filter.
 *
 * Delegates to the shared guard in `@/lib/api-params` so every list endpoint
 * (orders, customers, products, …) sanitises free text identically.
 *
 * Double quotes delimit the value (PostgREST strips them), so any quote or
 * backslash inside the value is removed and the metacharacters that would
 * otherwise break the expression are neutralised. A single quote is only
 * removed when the term looks like an injection attempt, so names such as
 * "O'Brien" still match.
 */
export function escapeFilterValue(value: string): string {
  return sanitizeSearchTerm(value) ?? ''
}

/** Build a `ILIKE` pattern that matches the term anywhere in the value. */
function ilikePattern(value: string): string {
  return `%${escapeFilterValue(value)}%`
}

/**
 * Resolve a validated filter set into the concrete query parameters.
 * Exported so the API routes and the tests share one implementation.
 */
export function resolveOrderFilters(filters: OrderFilters, now: Date = new Date()): {
  dateRange: ResolvedDateRange
  search: string | null
  status: string | null
  paymentStatus: string | null
  shippingStatuses: string[] | null
  customerId: string | null
  productId: string | null
} {
  const dateRange = resolveDateRange(
    {
      dateRange: filters.dateRange,
      from: filters.from,
      to: filters.to,
    },
    now
  )

  const search = filters.search?.trim() || null
  const status = filters.status && ORDER_STATUSES.includes(filters.status as never) ? filters.status : null
  const paymentStatus =
    filters.paymentStatus && PAYMENT_STATUSES.includes(filters.paymentStatus as never)
      ? filters.paymentStatus
      : null

  const shippingStatuses = filters.shippingStatus
    ? SHIPPING_STATUS_GROUPS[filters.shippingStatus] ?? null
    : null

  return {
    dateRange,
    search,
    status,
    paymentStatus,
    shippingStatuses,
    customerId: filters.customerId?.trim() || null,
    productId: filters.productId?.trim() || null,
  }
}

/**
 * Maximum number of order ids injected into the search `or()` expression.
 *
 * Every id is a UUID (36 characters), so 250 ids is roughly 9 KB of query
 * string — the same order of magnitude as the customer-id lookup that used to
 * work in the old implementation.
 */
export const MAX_PRODUCT_MATCH_IDS = 250

/**
 * Resolve the ids of orders that contain a product matching `term`.
 *
 * The product name lives in `order_items`, and PostgREST cannot combine an
 * embedded filter with a top-level `or()` (PGRST100 "failed to parse logic
 * tree"). The union is therefore done in two steps:
 *
 *   1. find the matching `order_items` rows (server-side `ILIKE`),
 *   2. inject the distinct `order_id`s into the top-level `or()` as
 *      `id.in.(...)`, which unions correctly with the other search terms.
 *
 * Returns the distinct order ids (capped) and whether the cap was reached.
 */
export async function findOrderIdsByProductSearch(
  supabase: SupabaseClient,
  term: string,
  limit: number = MAX_PRODUCT_MATCH_IDS
): Promise<{ ids: string[]; truncated: boolean }> {
  const pattern = `%${escapeFilterValue(term)}%`
  if (pattern === '%%') return { ids: [], truncated: false }

  const rows = await fetchAllRows<{ order_id: string }>(
    (from, to) =>
      supabase
        .from('order_items')
        .select('order_id')
        .or(`product_name.ilike.${pattern},product_name_ar.ilike.${pattern},sku.ilike.${pattern}`)
        .order('order_id', { ascending: true })
        .range(from, to),
    1000
  )

  const ids: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row.order_id || seen.has(row.order_id)) continue
    seen.add(row.order_id)
    ids.push(row.order_id)
    if (ids.length >= limit) {
      return { ids, truncated: rows.length >= limit }
    }
  }
  return { ids, truncated: false }
}

/**
 * Apply the resolved filters to a PostgREST query builder.
 *
 * Every filter is combined with AND; the free-text search is an OR across
 * the searchable order columns. Product filtering is an AND (an order must
 * contain the product) and is expressed with an inner embed so it does not
 * duplicate orders that contain the product more than once.
 */
export function applyOrderFilters<T extends { select: (...a: never[]) => unknown }>(
  query: any,
  resolved: ReturnType<typeof resolveOrderFilters>,
  options: { includeProductEmbed?: boolean; productMatchIds?: string[] } = {}
): any {
  const { dateRange, search, status, paymentStatus, shippingStatuses, customerId, productId } = resolved
  const productMatchIds = options.productMatchIds

  if (dateRange.from) query = query.gte('created_at', dateRange.from)
  if (dateRange.to) query = query.lte('created_at', dateRange.to)

  // A specific status AND a shipping phase are BOTH applied. The phases are
  // derived from the status, so a contradictory pair simply matches nothing —
  // which is honest. Silently dropping one of them (the previous behaviour)
  // is exactly the kind of "the card and the table disagree" bug this layer
  // exists to remove.
  if (status) {
    query = query.eq('status', status)
  }
  if (shippingStatuses && shippingStatuses.length > 0) {
    query = query.in('status', shippingStatuses)
  }

  if (paymentStatus) query = query.eq('payment_status', paymentStatus)
  if (customerId) query = query.eq('customer_id', customerId)

  if (search) {
    const pattern = ilikePattern(search)
    const terms: string[] = [
      `order_number.ilike."${pattern}"`,
      `tracking_number.ilike."${pattern}"`,
      `shipping_address->>name.ilike."${pattern}"`,
      `shipping_address->>phone.ilike."${pattern}"`,
      `shipping_address->>city.ilike."${pattern}"`,
    ]
    if (UUID_RE.test(search)) {
      terms.push(`id.eq.${search}`)
    }
    // Product-name matches are folded in as an id branch. PostgREST cannot
    // put an EMBEDDED resource inside `or()` (it fails with PGRST100), so the
    // product branch is resolved to order ids first and injected here as a
    // plain top-level `id.in.(...)` term — which unions correctly.
    if (productMatchIds && productMatchIds.length > 0) {
      terms.push(`id.in.(${productMatchIds.join(',')})`)
    }
    query = query.or(terms.join(','))
  }

  if (productId) {
    query = query.eq('items.product_id', productId)
  }

  return query
}

/**
 * The full query used by the list, the statistics and the exports.
 *
 * `productId` uses an inner embed on `order_items` so an order that contains
 * the product twice is still returned once.
 */
export async function buildOrderQuery(
  supabase: SupabaseClient,
  filters: OrderFilters,
  options: OrderQueryOptions = {}
): Promise<{ query: any; resolved: ReturnType<typeof resolveOrderFilters> }> {
  const resolved = resolveOrderFilters(filters)
  const select = options.select ?? ORDER_LIST_SELECT

  const needsItemEmbed = Boolean(resolved.productId)
  const finalSelect = needsItemEmbed
    ? `${select.replace(/\n?\s*items:order_items\([^)]*\)/, '')}, items:order_items!inner(product_id)`
    : select

  let query = supabase.from('orders').select(finalSelect, { count: options.count ?? 'exact' })

  query = applyOrderFilters(query, resolved, {
    productMatchIds: options.productMatchIds,
  })

  const order = options.order ?? [{ column: 'created_at', ascending: false }, { column: 'id', ascending: false }]
  for (const o of order) {
    query = query.order(o.column, { ascending: o.ascending })
  }

  if (options.range) {
    query = query.range(options.range.from, options.range.to)
  }

  return { query, resolved }
}

/** Validated pagination inputs. */
export interface PaginationParams {
  page: number
  pageSize: number
  offset: number
}

export const MAX_PAGE_SIZE = 200
export const DEFAULT_PAGE_SIZE = 20

export function parsePagination(params: URLSearchParams): PaginationParams | { error: string } {
  const rawPage = Number.parseInt(params.get('page') ?? '1', 10)
  const rawPageSize = Number.parseInt(params.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10)

  if (!Number.isFinite(rawPage) || rawPage < 1) return { error: 'رقم الصفحة غير صالح' }
  if (!Number.isFinite(rawPageSize) || rawPageSize < 1) return { error: 'حجم الصفحة غير صالح' }

  const pageSize = Math.min(rawPageSize, MAX_PAGE_SIZE)
  return { page: rawPage, pageSize, offset: (rawPage - 1) * pageSize }
}

/** Validated sort inputs. */
export function parseSort(params: URLSearchParams): { sortBy: OrderSortKey; ascending: boolean } {
  const requested = (params.get('sortBy') ?? 'created_at') as OrderSortKey
  const sortBy = requested in ORDER_SORT_COLUMNS ? requested : 'created_at'
  const ascending = (params.get('sortOrder') ?? 'desc').toLowerCase() === 'asc'
  return { sortBy, ascending }
}
