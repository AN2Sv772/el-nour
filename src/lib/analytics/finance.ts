/**
 * The finance & analytics calculation layer — PURE, no database access.
 *
 * WHY A SEPARATE LAYER
 *
 * The metric cards answer "how much?" — one number with a status. A finance
 * view answers a different question: "where did the money go?", which needs
 * an ORDERED STATEMENT whose lines add up, and whose subtotals are withheld
 * the moment one of their inputs is not a fact.
 *
 * The rule that governs every line here:
 *
 *   A LINE IS ONLY DRAWN WHEN ITS INPUTS ARE FACTS.
 *
 * So the gross profit is not drawn when the product costs are unknown, and
 * the final profit is not drawn when the returned-orders loss is unknown —
 * even if the provisional profit is computable. The owner's own accounting
 * (`src/lib/finance.ts`) has exactly this split: a *provisional* profit and a
 * *reconciled* profit, and only the second one knows about returns.
 *
 * The P&L is built FROM the metric set (`BusinessOverview.byKey`), never from
 * a second, parallel calculation. That is what makes it impossible for the
 * finance page and the dashboard card to disagree.
 */

import type { BusinessOverview, Metric, MetricStatus, ProductPerformance } from '@/lib/metrics/types'
import { round2 } from '@/lib/finance'
import { formatNumber } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type PnlLineKind = 'revenue' | 'cost' | 'subtotal' | 'result'

export interface PnlLine {
  key: string
  label: string
  /** null when the status is not `actual` — the UI must show the status instead. */
  value: number | null
  kind: PnlLineKind
  status: MetricStatus
  /** The formula, in plain Arabic. */
  calculation: string
  source: string[]
  missing: string[]
  /** True when the line is a deduction (shown with a minus sign). */
  deduction?: boolean
}

export interface ProfitAndLoss {
  lines: PnlLine[]
  /** The provisional profit (before the returned-orders loss). */
  provisionalProfit: number | null
  /** The final profit (after the returned-orders loss) — withheld unless known. */
  finalProfit: number | null
  status: MetricStatus
  missing: string[]
  /** A one-line Arabic summary of what the statement can and cannot say. */
  summary: string
}

export interface CashBatch {
  id: string
  createdAt: string | null
  expected: number | null
  received: number | null
  /** Courier deductions recorded against this batch. */
  deductions: number
  /** received − expected; negative = the courier still owes the business. */
  difference: number | null
  status: string | null
}

export interface CashFlow {
  status: MetricStatus
  batches: CashBatch[]
  totals: {
    expected: number | null
    received: number | null
    outstanding: number | null
    deductions: number
  }
  /** How much of the window's recognised sales is backed by real cash. */
  cashBackedRatio: number | null
  missing: string[]
  summary: string
}

export interface BlindProduct {
  productId: string
  name: string
  sku: string | null
  units: number
  revenue: number
}

export interface ProductEconomics {
  status: MetricStatus
  products: (ProductPerformance & { revenueShare: number | null })[]
  totals: {
    revenue: number
    cost: number
    units: number
  }
  /** Revenue share of the top 1 / top 3 products (null when there is no revenue). */
  concentration: { top1Share: number | null; top3Share: number | null }
  /** Revenue earned by products whose cost is unknown. */
  blindRevenue: number | null
  blindProductCount: number
  blindProducts: BlindProduct[]
  missing: string[]
  summary: string
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function metricValue(overview: BusinessOverview, key: string): number | null {
  const metric = overview.byKey?.[key]
  return metric && metric.value !== null ? metric.value : null
}

function metricStatus(overview: BusinessOverview, key: string): MetricStatus {
  return overview.byKey?.[key]?.provenance?.status ?? 'unavailable'
}

function metricMissing(overview: BusinessOverview, key: string): string[] {
  return overview.byKey?.[key]?.provenance?.missing ?? []
}

function metricSource(overview: BusinessOverview, key: string): string[] {
  return overview.byKey?.[key]?.provenance?.source ?? []
}

function metricCalculation(overview: BusinessOverview, key: string): string {
  return overview.byKey?.[key]?.provenance?.calculation ?? ''
}

/** A line copied from a metric, so the statement and the cards cannot drift. */
function lineFromMetric(
  overview: BusinessOverview,
  key: string,
  kind: PnlLineKind,
  label?: string,
  deduction = false
): PnlLine {
  const metric: Metric | undefined = overview.byKey?.[key]
  return {
    key,
    label: label ?? metric?.label ?? key,
    value: metric && metric.value !== null ? metric.value : null,
    kind,
    status: metric?.provenance?.status ?? 'unavailable',
    calculation: metric?.provenance?.calculation ?? '',
    source: metric?.provenance?.source ?? [],
    missing: metric?.provenance?.missing ?? [],
    deduction,
  }
}

/* ------------------------------------------------------------------ */
/* Profit & loss                                                       */
/* ------------------------------------------------------------------ */

/**
 * Build the profit & loss statement from the metric set.
 *
 * The subtotals are computed HERE (not in the metrics engine) because they
 * are view-level derived numbers — but their INPUTS are the metrics, so the
 * two can never disagree.
 */
export function buildProfitAndLoss(overview: BusinessOverview): ProfitAndLoss {
  const lines: PnlLine[] = []

  const revenue = metricValue(overview, 'revenue')
  const productCosts = metricValue(overview, 'product_costs')
  const shippingCost = metricValue(overview, 'shipping_cost')
  const advertising = metricValue(overview, 'advertising_spend')
  const expenses = metricValue(overview, 'operating_expenses')
  const returnedLoss = metricValue(overview, 'returned_loss')

  lines.push(lineFromMetric(overview, 'revenue', 'revenue'))

  /* Gross profit = revenue − product costs. */
  const grossProfit =
    revenue !== null && productCosts !== null ? round2(revenue - productCosts) : null
  lines.push({
    key: 'gross_profit',
    label: 'مجمل الربح',
    value: grossProfit,
    kind: 'subtotal',
    status: grossProfit === null ? 'incomplete' : 'actual',
    calculation: 'المبيعات المحتسبة − تكلفة المنتجات',
    source: ['orders', 'order_items', 'products'],
    missing:
      grossProfit === null
        ? [
            ...metricMissing(overview, 'product_costs'),
            'تكلفة المنتجات غير مكتملة — لا يمكن احتساب مجمل الربح',
          ]
        : [],
  })

  lines.push(lineFromMetric(overview, 'product_costs', 'cost', 'تكلفة المنتجات', true))
  lines.push(lineFromMetric(overview, 'shipping_cost', 'cost', 'تكلفة الشحن', true))
  lines.push(lineFromMetric(overview, 'advertising_spend', 'cost', 'مصروف الإعلانات', true))
  lines.push(lineFromMetric(overview, 'operating_expenses', 'cost', 'المصروفات التشغيلية', true))
  lines.push(lineFromMetric(overview, 'returned_loss', 'cost', 'خسارة المرتجعات (تقديري)', true))

  /* Provisional profit — mirrors the `net_profit` metric exactly. */
  const provisionalMetric = overview.byKey?.net_profit
  const provisionalProfit = provisionalMetric?.value ?? null
  lines.push({
    key: 'net_profit',
    label: 'صافي الربح المبدئي (قبل المرتجعات)',
    value: provisionalProfit,
    kind: 'result',
    status: provisionalMetric?.provenance?.status ?? 'unavailable',
    calculation:
      provisionalMetric?.provenance?.calculation ??
      'المبيعات المحتسبة − تكلفة المنتجات − تكلفة الشحن − الإعلانات − المصروفات',
    source: provisionalMetric?.provenance?.source ?? [],
    missing: provisionalMetric?.provenance?.missing ?? [],
  })

  /* Final profit — only when the returned-orders loss is known. */
  const canStateFinal = provisionalProfit !== null && returnedLoss !== null
  const finalProfit = canStateFinal ? round2((provisionalProfit as number) - (returnedLoss as number)) : null
  lines.push({
    key: 'final_profit',
    label: 'صافي الربح النهائي (بعد المرتجعات)',
    value: finalProfit,
    kind: 'result',
    status: canStateFinal ? 'actual' : 'incomplete',
    calculation: 'صافي الربح المبدئي − خسارة المرتجعات',
    source: ['daily_reconciliations', 'orders'],
    missing: canStateFinal
      ? []
      : [
          ...metricMissing(overview, 'returned_loss'),
          'خسارة المرتجعات غير معروفة — الربح النهائي محجوب',
        ],
  })

  const missing = [...new Set(lines.flatMap(l => l.missing))]
  const status: MetricStatus = canStateFinal ? 'actual' : missing.length > 0 ? 'incomplete' : 'unavailable'

  const summary = canStateFinal
    ? 'قائمة الدخل مكتملة: كل بنودها أرقام فعلية من سجلات المتجر.'
    : missing.length > 0
      ? `قائمة الدخل ناقصة — ${missing.length} سبب عدم اكتمال. الأرقام المعروضة أرقام فعلية فقط، والباقي محجوب.`
      : 'قائمة الدخل لا تحتوي على بيانات كافية لل الفترة المحددة.'

  return { lines, provisionalProfit, finalProfit, status, missing, summary }
}

/* ------------------------------------------------------------------ */
/* Cash flow                                                           */
/* ------------------------------------------------------------------ */

export interface CashFlowInput {
  batches: {
    id?: string
    created_at?: string | null
    expected_amount: number | null
    received_amount: number | null
    status: string | null
  }[]
  deductions: { batch_id: string | null; amount: number | null }[]
  /** Recognised sales in the same window — the denominator of the coverage. */
  recognizedSales: number | null
}

/**
 * The cash view: what the couriers were supposed to pay, what they paid, and
 * what they still hold.
 *
 * With no collection batches recorded, this returns `unavailable` — NOT zero.
 * "Nothing was collected" and "nothing was recorded" are different facts, and
 * only one of them is true in a store that has never recorded a batch.
 */
export function buildCashFlow(input: CashFlowInput): CashFlow {
  const deductionsByBatch = new Map<string, number>()
  for (const deduction of input.deductions) {
    if (!deduction.batch_id) continue
    const amount = deduction.amount || 0
    deductionsByBatch.set(deduction.batch_id, round2((deductionsByBatch.get(deduction.batch_id) ?? 0) + amount))
  }

  const batches: CashBatch[] = input.batches.map(batch => {
    const id = batch.id ?? ''
    const deductions = id ? (deductionsByBatch.get(id) ?? 0) : 0
    const expected = batch.expected_amount ?? null
    const received = batch.received_amount ?? null
    const difference =
      expected !== null && received !== null ? round2(received - expected) : null
    return {
      id,
      createdAt: batch.created_at ?? null,
      expected,
      received,
      deductions,
      difference,
      status: batch.status ?? null,
    }
  })

  if (batches.length === 0) {
    return {
      status: 'unavailable',
      batches: [],
      totals: { expected: null, received: null, outstanding: null, deductions: 0 },
      cashBackedRatio: null,
      missing: ['لا توجد دفعات تحصيل مسجّلة — لا يمكن معرفة النقد المحصّل أو المحتجز'],
      summary:
        'لا توجد دفعات تحصيل في النظام. سجّل أول دفعة عند استلام النقد من شركة الشحن لتظهر حركة النقد هنا.',
    }
  }

  const expected = round2(batches.reduce((s, b) => s + (b.expected ?? 0), 0))
  const received = round2(batches.reduce((s, b) => s + (b.received ?? 0), 0))
  const outstanding = round2(expected - received)
  const deductions = round2(batches.reduce((s, b) => s + b.deductions, 0))

  const cashBackedRatio =
    input.recognizedSales !== null && input.recognizedSales > 0
      ? round2((received / input.recognizedSales) * 100)
      : null

  const missing: string[] = []
  if (batches.some(b => b.expected === null || b.received === null)) {
    missing.push('بعض الدفعات لا يوجد لها مبلغ متوقع أو مستلم مسجّل')
  }
  if (cashBackedRatio === null) {
    missing.push('لا توجد مبيعات محتسبة في الفترة تُقارَن بها التحصيلات')
  }

  return {
    status: missing.length > 0 ? 'incomplete' : 'actual',
    batches,
    totals: { expected, received, outstanding, deductions },
    cashBackedRatio,
    missing,
    summary:
      outstanding > 0
        ? `يوجد ${outstanding} مستحق لدى شركات الشحن لم يصل إلى المتجر بعد.`
        : 'كل المبالغ المتوقعة من شركات الشحن تم استلامها.',
  }
}

/* ------------------------------------------------------------------ */
/* Product economics                                                   */
/* ------------------------------------------------------------------ */

/**
 * Per-product economics: revenue, cost, margin, and — the important part —
 * how much of the revenue was earned by products whose cost nobody knows.
 *
 * The last number is the one that matters: revenue without a cost is revenue
 * the business cannot price. It is the gap between "what we sold" and "what
 * we actually made".
 */
export function buildProductEconomics(
  products: ProductPerformance[],
  recognizedRevenue: number | null
): ProductEconomics {
  const sorted = [...products].sort((a, b) => b.revenue - a.revenue)
  const totalRevenue = round2(sorted.reduce((s, p) => s + p.revenue, 0))
  const totalCost = round2(sorted.reduce((s, p) => s + p.cost, 0))
  const totalUnits = sorted.reduce((s, p) => s + p.units, 0)

  const withShare = sorted.map(p => ({
    ...p,
    revenueShare: totalRevenue > 0 ? round2((p.revenue / totalRevenue) * 100) : null,
  }))

  const blind = sorted.filter(p => p.margin === null)
  const blindRevenue = blind.length > 0 ? round2(blind.reduce((s, p) => s + p.revenue, 0)) : null

  const top1Share = withShare[0]?.revenueShare ?? null
  const top3Share =
    withShare.length > 0
      ? round2(withShare.slice(0, 3).reduce((s, p) => s + (p.revenueShare ?? 0), 0))
      : null

  const missing: string[] = []
  if (blind.length > 0) {
    missing.push(
      `${blind.length} منتج بيع بدون تكلفة مسجّلة — ${blindRevenue} من المبيعات بدون تكلفة معروفة`
    )
  }
  if (totalRevenue === 0) {
    missing.push('لا توجد مبيعات في الفترة')
  }

  const blindSharePercent =
    blindRevenue !== null && totalRevenue > 0 ? round2((blindRevenue / totalRevenue) * 1000) / 10 : null

  return {
    status: blind.length > 0 ? 'incomplete' : 'actual',
    products: withShare,
    totals: { revenue: totalRevenue, cost: totalCost, units: totalUnits },
    concentration: { top1Share, top3Share },
    blindRevenue,
    blindProductCount: blind.length,
    blindProducts: blind.map(p => ({
      productId: p.productId,
      name: p.name,
      sku: p.sku,
      units: p.units,
      revenue: p.revenue,
    })),
    missing,
    summary:
      blind.length > 0
        ? `${formatNumber(blindRevenue ?? 0)} من مبيعات المنتجات (${blindSharePercent ?? 0}%) جاءت من منتجات بلا تكلفة مسجّلة — لا يمكن معرفة ربحها.`
        : 'كل المنتجات التي باعت لها تكلفة مسجّلة — هامش الربح لكل منتج محسوب فعلياً.',
  }
}

/** Recognised revenue for the cash-coverage denominator. */
export function recognizedRevenueOf(overview: BusinessOverview): number | null {
  return metricValue(overview, 'revenue')
}

/** The metric's own calculation string (for the page footer). */
export function calculationOf(overview: BusinessOverview, key: string): string {
  return metricCalculation(overview, key)
}
