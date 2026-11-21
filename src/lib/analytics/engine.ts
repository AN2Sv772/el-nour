/**
 * The database side of the analytics module.
 *
 * It reuses the metric engine's READ helpers (same queries, same filters,
 * same timezone) and adds only what the finance views need that the metric
 * set does not carry: the collection batches with their dates, the courier
 * deductions per batch, and the expenses grouped by category.
 *
 * Read-only. Nothing here writes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildBusinessOverview,
  fetchCollections,
  fetchDeductions,
  fetchExpenses,
  fetchExpensesTableIsEmpty,
  fetchFixedShippingFee,
  fetchItemsForOrders,
  fetchOrders,
  fetchProducts,
  fetchReconciliations,
  normalizePreset,
  previousWindow,
} from '@/lib/metrics/engine'
import { businessDateString, resolveDateRange, BUSINESS_TIME_ZONE } from '@/lib/date-range'
import {
  buildCashFlow,
  buildProductEconomics,
  buildProfitAndLoss,
  recognizedRevenueOf,
  type CashFlow,
  type ProductEconomics,
  type ProfitAndLoss,
} from './finance'
import type { MetricWindow } from '@/lib/metrics/types'

type Db = SupabaseClient

export interface ExpenseCategory {
  category: string
  amount: number
  count: number
}

export interface AnalyticsOptions {
  dateRange?: string | null
  from?: string | null
  to?: string | null
  now?: Date
}

export interface AnalyticsResult {
  window: MetricWindow
  profitAndLoss: ProfitAndLoss
  cashFlow: CashFlow
  productEconomics: ProductEconomics
  expensesByCategory: ExpenseCategory[]
  /** True when the `expenses` table holds no rows at all. */
  expensesNotRecorded: boolean
  /** The same window, one period earlier — for the "versus previous" line. */
  previous: { from: string | null; to: string | null; revenue: number | null }
}

/**
 * Build every finance view for one window.
 *
 * The window resolution and the period comparison come from the shared date
 * engine, so "آخر 30 يومًا" means the same thing here as on the dashboard and
 * in the agent's answer.
 */
export async function buildAnalytics(db: Db, options: AnalyticsOptions = {}): Promise<AnalyticsResult> {
  const now = options.now ?? new Date()
  const hasCustom = Boolean(options.from || options.to)
  const preset = normalizePreset(options.dateRange, hasCustom)
  const range = resolveDateRange({ dateRange: preset, from: options.from, to: options.to }, now)
  const prev = previousWindow(range.from, range.to)

  const [
    orders,
    products,
    expenses,
    batches,
    deductions,
    reconciliations,
    fixedShippingFee,
    expensesTableIsEmpty,
  ] = await Promise.all([
    fetchOrders(db, range.from, range.to),
    fetchProducts(db),
    fetchExpenses(db, range.from, range.to),
    fetchCollections(db),
    fetchDeductions(db),
    fetchReconciliations(db),
    fetchFixedShippingFee(db),
    fetchExpensesTableIsEmpty(db),
  ])

  const items = await fetchItemsForOrders(db, orders.map(o => o.id))

  // The metric set is the single source of truth for every number that
  // appears in more than one place (the cards, the P&L, the agent's answers).
  const overview = await buildBusinessOverview(db, {
    dateRange: options.dateRange,
    from: options.from,
    to: options.to,
    now,
    includePrevious: false,
  })

  const profitAndLoss = buildProfitAndLoss(overview)

  const cashFlow = buildCashFlow({
    batches,
    deductions,
    recognizedSales: recognizedRevenueOf(overview),
  })

  const productEconomics = buildProductEconomics(overview.products, recognizedRevenueOf(overview))

  /* Expenses by category — voided rows excluded. */
  const byCategory = new Map<string, { amount: number; count: number }>()
  for (const expense of expenses) {
    if (expense.voided_at) continue
    const category = expense.category || 'other'
    const entry = byCategory.get(category) || { amount: 0, count: 0 }
    entry.amount = round2(entry.amount + (expense.amount || 0))
    entry.count += 1
    byCategory.set(category, entry)
  }
  const expensesByCategory: ExpenseCategory[] = [...byCategory.entries()]
    .map(([category, entry]) => ({ category, amount: entry.amount, count: entry.count }))
    .sort((a, b) => b.amount - a.amount)

  /* Previous period revenue — the same formula, the previous window. */
  let previousRevenue: number | null = null
  if (prev.from && prev.to) {
    const prevOrders = await fetchOrders(db, prev.from, prev.to)
    previousRevenue = round2(
      prevOrders
        .filter(o => !['cancelled', 'returned'].includes(o.status))
        .reduce((s, o) => s + (o.total_amount || 0), 0)
    )
  }

  return {
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
    profitAndLoss,
    cashFlow,
    productEconomics,
    expensesByCategory,
    expensesNotRecorded: expensesTableIsEmpty,
    previous: { from: prev.from, to: prev.to, revenue: previousRevenue },
  }
}

/** The business day of an instant — used by the cash-flow timeline. */
export function dayOf(iso: string): string {
  return businessDateString(new Date(iso), BUSINESS_TIME_ZONE)
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
