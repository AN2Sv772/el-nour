/**
 * The database side of the metrics engine.
 *
 * It reads the REAL rows (paged, because PostgREST caps a response at 1000)
 * and hands them to the pure calculation layer. It never computes a business
 * figure itself — that keeps every number reproducible and testable.
 *
 * Every read is read-only. Nothing here writes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllByIds, fetchAllRows } from '@/lib/supabase/paginate'
import { businessDateString, resolveDateRange, BUSINESS_TIME_ZONE, DATE_RANGE_PRESETS } from '@/lib/date-range'
import {
  computeBusinessMetrics,
  attachComparison,
  type MetricCollectionBatch,
  type MetricCollectionDeduction,
  type MetricExpense,
  type MetricInputs,
  type MetricOrder,
  type MetricOrderItem,
  type MetricProduct,
  type MetricReconciliation,
} from './calculations'
import type { BusinessOverview, Metric } from './types'

/** The shape of the service client this engine needs. */
type Db = SupabaseClient

function inWindow<T extends { created_at?: string | null; expense_date?: string | null }>(
  q: any,
  from: string | null,
  to: string | null,
  column = 'created_at'
) {
  if (from) q = q.gte(column, from)
  if (to) q = q.lte(column, to)
  return q
}

export async function fetchOrders(db: Db, from: string | null, to: string | null): Promise<MetricOrder[]> {
  return fetchAllRows<MetricOrder>((f, t) =>
    inWindow(
      db.from('orders').select('id, total_amount, shipping_fee, status, payment_status, created_at'),
      from,
      to
    )
      .order('id', { ascending: true })
      .range(f, t)
  )
}

export async function fetchItemsForOrders(db: Db, orderIds: string[]): Promise<MetricOrderItem[]> {
  if (orderIds.length === 0) return []
  return fetchAllByIds<MetricOrderItem>(
    chunk => (f, t) =>
      db
        .from('order_items')
        .select('order_id, product_id, quantity, unit_cost')
        .in('order_id', chunk)
        .order('id', { ascending: true })
        .range(f, t),
    orderIds
  )
}

export async function fetchProducts(db: Db): Promise<MetricProduct[]> {
  return fetchAllRows<MetricProduct>((f, t) =>
    db
      .from('products')
      .select('id, name, sku, price, cost_price, stock_quantity, track_inventory')
      .order('id', { ascending: true })
      .range(f, t)
  )
}

/**
 * Is the `expenses` table completely empty?
 *
 * One row, counted exactly — cheap. It answers a question the window cannot:
 * "are there no expenses in this period, or does the store record no expenses
 * at all?" The second case must not be published as a zero.
 */
export async function fetchExpensesTableIsEmpty(db: Db): Promise<boolean> {
  const { count, error } = await db
    .from('expenses')
    .select('id', { count: 'exact', head: true })
  if (error) return false
  return (count ?? 0) === 0
}

export async function fetchExpenses(db: Db, from: string | null, to: string | null): Promise<MetricExpense[]> {
  const fromDay = from ? from.slice(0, 10) : null
  const toDay = to ? to.slice(0, 10) : null
  return fetchAllRows<MetricExpense>((f, t) =>
    inWindow(
      db.from('expenses').select('amount, expense_date, category, voided_at'),
      fromDay,
      toDay,
      'expense_date'
    )
      .order('id', { ascending: true })
      .range(f, t)
  )
}

export async function fetchCollections(db: Db): Promise<MetricCollectionBatch[]> {
  return fetchAllRows<MetricCollectionBatch>((f, t) =>
    db
      .from('collection_batches')
      .select('expected_amount, received_amount, status')
      .order('id', { ascending: true })
      .range(f, t)
  )
}

export async function fetchDeductions(db: Db): Promise<MetricCollectionDeduction[]> {
  return fetchAllRows<MetricCollectionDeduction>((f, t) =>
    db
      .from('collection_deductions')
      // The real column is `label` (free text), not `category`.
      .select('batch_id, amount, label')
      .order('id', { ascending: true })
      .range(f, t)
  )
}

export async function fetchReconciliations(db: Db): Promise<MetricReconciliation[]> {
  return fetchAllRows<MetricReconciliation>((f, t) =>
    db
      .from('daily_reconciliations')
      // The real column is `business_date`; the table has no `status`.
      .select('business_date, returned_orders_count')
      .order('id', { ascending: true })
      .range(f, t)
  )
}

export async function fetchFixedShippingFee(db: Db): Promise<number | null> {
  const { data } = await db
    .from('business_settings')
    .select('default_shipping_fee')
    .limit(1)
    .maybeSingle()
  const value = data?.default_shipping_fee
  return value === null || value === undefined ? null : Number(value)
}

/**
 * The previous window of the SAME length, immediately before the current one.
 *
 * `null` bounds (the "all" preset) have no meaningful previous period, so the
 * comparison is simply absent rather than invented.
 */
export function previousWindow(
  from: string | null,
  to: string | null
): { from: string | null; to: string | null } {
  if (!from || !to) return { from: null, to: null }
  const fromMs = new Date(from).getTime()
  const toMs = new Date(to).getTime()
  const length = toMs - fromMs
  if (!Number.isFinite(length) || length <= 0) return { from: null, to: null }
  const prevTo = new Date(fromMs - 1).toISOString()
  const prevFrom = new Date(fromMs - 1 - length).toISOString()
  return { from: prevFrom, to: prevTo }
}

/** The presets the shared date engine understands, including its legacy aliases. */
const VALID_PRESETS = new Set<string>([
  ...DATE_RANGE_PRESETS.map(p => p.value),
  'quarter',
  'week',
  'month',
  'year',
])

/**
 * An unknown preset must NOT silently become "all time".
 *
 * `resolveDateRange` treats an unrecognised preset as an open range, which is
 * safe for a list of orders but misleading for a metric card: the reader
 * would think "this month" while seeing "since the beginning". So an unknown
 * preset falls back to this month, and the response says which window it used.
 */
export function normalizePreset(
  preset: string | null | undefined,
  hasCustomBounds: boolean
): string | null {
  if (hasCustomBounds) return null
  if (!preset) return 'this_month'
  const value = preset.trim()
  return VALID_PRESETS.has(value) ? value : 'this_month'
}

export interface OverviewOptions {
  dateRange?: string | null
  from?: string | null
  to?: string | null
  now?: Date
  /**
   * Compute the previous window too (the dashboard and the agent compare
   * periods). The analytics module turns it off — it never draws a comparison,
   * so it does not pay for a second pass over the orders.
   */
  includePrevious?: boolean
}

/**
 * A short-lived cache of the metric set.
 *
 * The same window is read by the dashboard, the cockpit, the analytics page,
 * the decisions engine and the briefing — often within the same minute. Each
 * read costs ~20 round trips to Postgres, so a 20-second cache removes most
 * of that duplication.
 *
 * The TTL is deliberately short: a number must never be visibly stale. The
 * cache holds the COMPUTED TIME inside the payload, so the UI always says
 * when the numbers were produced.
 */
const OVERVIEW_CACHE_TTL_MS = 20_000
const OVERVIEW_CACHE_MAX = 60
const overviewCache = new Map<string, { value: BusinessOverview; expiresAt: number }>()

function cacheKey(options: OverviewOptions, now: Date): string {
  const bucket = Math.floor(now.getTime() / OVERVIEW_CACHE_TTL_MS)
  return [
    options.dateRange ?? '',
    options.from ?? '',
    options.to ?? '',
    options.includePrevious === false ? 'noprev' : 'prev',
    bucket,
  ].join('|')
}

function readCache(key: string): BusinessOverview | null {
  const hit = overviewCache.get(key)
  if (!hit) return null
  if (hit.expiresAt < Date.now()) {
    overviewCache.delete(key)
    return null
  }
  return hit.value
}

function writeCache(key: string, value: BusinessOverview): void {
  if (overviewCache.size >= OVERVIEW_CACHE_MAX) {
    const oldest = overviewCache.keys().next().value
    if (oldest !== undefined) overviewCache.delete(oldest)
  }
  overviewCache.set(key, { value, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS })
}

/** Drop the cached metric sets (used after a write that changes the numbers). */
export function invalidateOverviewCache(): void {
  overviewCache.clear()
}

/**
 * Build the executive overview for a window.
 *
 * The previous period is computed by running the SAME calculation over the
 * previous window, so a comparison is never a different formula.
 */
export async function buildBusinessOverview(
  db: Db,
  options: OverviewOptions = {}
): Promise<BusinessOverview> {
  const now = options.now ?? new Date()
  const key = cacheKey(options, now)
  const cached = readCache(key)
  if (cached) return cached
  const hasCustom = Boolean(options.from || options.to)
  const preset = normalizePreset(options.dateRange, hasCustom)
  const range = resolveDateRange(
    { dateRange: preset, from: options.from, to: options.to },
    now
  )
  const prev = previousWindow(range.from, range.to)

  // The current window and the previous one are fetched together: two
  // sequential passes cost twice the round trips for the same result.
  const wantPrevious = options.includePrevious !== false && Boolean(prev.from && prev.to)

  const [
    orders,
    products,
    expenses,
    collections,
    collectionDeductions,
    reconciliations,
    fixedShippingFee,
    expensesTableIsEmpty,
    prevOrders,
    prevExpenses,
    prevCollections,
    prevDeductions,
    prevReconciliations,
  ] = await Promise.all([
    fetchOrders(db, range.from, range.to),
    fetchProducts(db),
    fetchExpenses(db, range.from, range.to),
    fetchCollections(db),
    fetchDeductions(db),
    fetchReconciliations(db),
    fetchFixedShippingFee(db),
    fetchExpensesTableIsEmpty(db),
    wantPrevious ? fetchOrders(db, prev.from, prev.to) : Promise.resolve([]),
    wantPrevious ? fetchExpenses(db, prev.from, prev.to) : Promise.resolve([]),
    wantPrevious ? fetchCollections(db) : Promise.resolve([]),
    wantPrevious ? fetchDeductions(db) : Promise.resolve([]),
    wantPrevious ? fetchReconciliations(db) : Promise.resolve([]),
  ])

  // The order lines for both windows, also together.
  const [items, prevItems] = await Promise.all([
    fetchItemsForOrders(db, orders.map(o => o.id)),
    wantPrevious ? fetchItemsForOrders(db, prevOrders.map(o => o.id)) : Promise.resolve([]),
  ])

  const inputs: MetricInputs = {
    orders,
    items,
    products,
    expenses,
    collections,
    collectionDeductions,
    reconciliations,
    // No advertising platform is connected yet. When one is, this becomes a
    // real read — never a fabricated number.
    advertising: null,
    fixedShippingFee,
    expensesTableIsEmpty,
    businessDate: (iso: string) => businessDateString(new Date(iso), BUSINESS_TIME_ZONE),
  }

  const current = computeBusinessMetrics(inputs, now)

  // Previous period — the same engine, the previous window.
  let previousByKey: Record<string, number | null> = {}
  if (wantPrevious) {
    const previous = computeBusinessMetrics(
      {
        ...inputs,
        orders: prevOrders,
        items: prevItems,
        expenses: prevExpenses,
        collections: prevCollections,
        collectionDeductions: prevDeductions,
        reconciliations: prevReconciliations,
      },
      now
    )
    previousByKey = Object.fromEntries(
      previous.metrics.map(m => [m.key, m.value] as [string, number | null])
    )
  }

  const metrics = attachComparison(current.metrics, previousByKey)
  const byKey: Record<string, Metric> = {}
  for (const metric of metrics) byKey[metric.key] = metric

  const result: BusinessOverview = {
    window: {
      preset: range.preset,
      label: range.label,
      from: range.from,
      to: range.to,
      previousFrom: prev.from,
      previousTo: prev.to,
      timezone: BUSINESS_TIME_ZONE,
      computedAt: now.toISOString(),
    },
    metrics,
    byKey,
    alerts: current.alerts,
    health: current.health,
    gaps: current.gaps,
    topProducts: current.topProducts,
    products: current.products,
    losingProducts: current.losingProducts,
    series: current.series,
  }

  writeCache(key, result)
  return result
}
