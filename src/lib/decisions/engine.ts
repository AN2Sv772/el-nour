/**
 * The database side of the decision engine.
 *
 * It reads REAL rows (paged), assembles the snapshot the rules read, and
 * returns the decisions. It never writes, and it never computes a business
 * figure that the metrics engine already defines — the revenue, the order
 * counts and the blind revenue all come from `buildBusinessOverview`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessOverview } from '@/lib/metrics/types'
import {
  buildBusinessOverview,
  fetchExpensesTableIsEmpty,
  fetchFixedShippingFee,
  fetchOrders,
  normalizePreset,
  previousWindow,
} from '@/lib/metrics/engine'
import { resolveDateRange } from '@/lib/date-range'
import { round2 } from '@/lib/finance'
import { evaluateDecisions, type DecisionsSnapshot } from './rules'
import type { Decision } from './types'

type Db = SupabaseClient

export interface DecisionsOptions {
  dateRange?: string | null
  from?: string | null
  to?: string | null
  now?: Date
  /**
   * A pre-built metric set for the SAME window.
   *
   * The caller (the briefing, the cockpit) usually already has it — passing
   * it in saves one full pass over the orders. It must be the same window,
   * otherwise the decisions would judge different numbers than the page.
   */
  overview?: BusinessOverview
}

/** Orders older than this many days are "stuck". */
const STUCK_DAYS = 30

export interface DecisionsResult {
  window: {
    preset: string
    label: string
    from: string | null
    to: string | null
    timezone: string
  }
  decisions: Decision[]
  /** The snapshot the rules read — exposed so the UI can show the basis. */
  snapshot: {
    countedOrders: number
    deliveredOrders: number
    backlog: DecisionsSnapshot['backlog']
    revenue: number
    profitStated: boolean
  }
}

/**
 * Build the decision list for a window.
 *
 * The backlog is measured over ALL open orders (not only the window's),
 * because a request from three months ago is stuck whether or not the window
 * includes it — and the window's revenue is what the other rules judge.
 */
export async function buildDecisions(db: Db, options: DecisionsOptions = {}): Promise<DecisionsResult> {
  const now = options.now ?? new Date()
  const hasCustom = Boolean(options.from || options.to)
  const preset = normalizePreset(options.dateRange, hasCustom)
  const range = resolveDateRange({ dateRange: preset, from: options.from, to: options.to }, now)

  const overview =
    options.overview ??
    (await buildBusinessOverview(db, {
      dateRange: options.dateRange,
      from: options.from,
      to: options.to,
      now,
      includePrevious: false,
    }))

  const [windowOrders, allOpenOrders, expensesTableIsEmpty, fixedShippingFee] = await Promise.all([
    fetchOrders(db, range.from, range.to),
    fetchOrders(db, null, null),
    fetchExpensesTableIsEmpty(db),
    fetchFixedShippingFee(db),
  ])

  /* ── Backlog over every open order ─────────────────────────────────── */
  const openOrders = allOpenOrders.filter(o => !['cancelled', 'returned', 'delivered'].includes(o.status))
  const stuckCutoff = now.getTime() - STUCK_DAYS * 86_400_000
  const olderThan30 = openOrders.filter(o => new Date(o.created_at).getTime() < stuckCutoff)
  const olderThan7 = openOrders.filter(o => new Date(o.created_at).getTime() < now.getTime() - 7 * 86_400_000)

  const backlog = {
    total: openOrders.length,
    value: round2(openOrders.reduce((s, o) => s + (o.total_amount || 0), 0)),
    olderThan30Days: olderThan30.length,
    valueOlderThan30Days: round2(olderThan30.reduce((s, o) => s + (o.total_amount || 0), 0)),
    olderThan7Days: olderThan7.length,
  }

  /* ── Shipping: what is actually collected vs what is configured ────── */
  const countedWindowOrders = windowOrders.filter(o => !['cancelled', 'returned'].includes(o.status))
  const shippingTotal = round2(
    countedWindowOrders.reduce((s, o) => s + (o.shipping_fee || 0), 0)
  )
  const avgShippingFeeCollected =
    countedWindowOrders.length > 0 ? round2(shippingTotal / countedWindowOrders.length) : null

  const revenue = overview.byKey?.revenue?.value ?? null
  const deliveredOrders = overview.byKey?.delivered_orders?.value ?? 0
  const totalOrders = overview.byKey?.total_orders?.value ?? 0

  /* ── Blind products: sold without a known cost ─────────────────────── */
  const blindProducts = overview.products
    .filter(p => p.margin === null)
    .map(p => ({ productId: p.productId, name: p.name, units: p.units, revenue: p.revenue }))
  const blindRevenue = round2(blindProducts.reduce((s, p) => s + p.revenue, 0))

  const productRevenue = round2(overview.products.reduce((s, p) => s + p.revenue, 0))
  const topProductShare =
    productRevenue > 0 && overview.products.length > 0
      ? round2((overview.products[0].revenue / productRevenue) * 100)
      : null

  const snapshot: DecisionsSnapshot = {
    window: { preset: range.preset, label: range.label, from: range.from, to: range.to },
    orders: windowOrders,
    countedOrders: totalOrders,
    deliveredOrders,
    backlog,
    ordersWithPayment: windowOrders.filter(o => o.payment_status && o.payment_status !== 'pending').length,
    avgShippingFeeCollected,
    fixedShippingFee,
    hasCollections: (overview.byKey?.cash_collected?.value ?? null) !== null,
    hasReconciliation: overview.metrics.some(m => m.key === 'returned_loss' && m.value !== null),
    expensesNotRecorded: expensesTableIsEmpty,
    adsConnected: false,
    blindProducts,
    blindRevenue,
    topProductShare,
    revenue: revenue ?? 0,
    profitStated: overview.byKey?.net_profit?.value !== null,
    now,
  }

  const decisions = evaluateDecisions(snapshot)

  return {
    window: {
      preset: range.preset,
      label: range.label,
      from: range.from,
      to: range.to,
      timezone: 'Africa/Cairo',
    },
    decisions,
    snapshot: {
      countedOrders: totalOrders,
      deliveredOrders,
      backlog,
      revenue: revenue ?? 0,
      profitStated: snapshot.profitStated,
    },
  }
}

/** The previous window, exposed for the UI's "compared to" line. */
export function previousOf(from: string | null, to: string | null) {
  return previousWindow(from, to)
}
