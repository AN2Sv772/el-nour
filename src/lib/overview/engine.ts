/**
 * Business Overview — the profit cockpit.
 *
 * This is the screen a store owner opens at 9 AM. It answers six questions:
 *   1. Did the business make money?            → PROFIT
 *   2. Is the advertising paying for itself?   → DELIVERED ROAS
 *   3. How much do we keep per order?          → PROFIT / ORDER
 *   4. How much money is stuck in the pipe?    → RTO EXPOSURE
 *   5. How much cash has not reached us?       → CASH MISSING
 *   6. Is it safe to grow right now?           → MONTH HEALTH
 *
 * Every card carries the same honesty contract as the rest of the app:
 * a number is published only when the data behind it exists. A missing input
 * produces a card with a status and a reason — never a plausible-looking
 * number, and never a zero that reads like "nothing happened".
 *
 * The module is pure: it takes the already-computed metric set and the
 * analytics result, so it can never disagree with the rest of the product.
 */

import type { BusinessOverview, MetricStatus } from '@/lib/metrics/types'
import type { AnalyticsResult } from '@/lib/analytics/engine'
import { round2 } from '@/lib/finance'

export type OverviewUnit = 'currency' | 'count' | 'percent' | 'ratio'

export interface OverviewCard {
  key: string
  label: string
  value: number | null
  unit: OverviewUnit
  status: MetricStatus
  /** The formula, in plain Arabic. */
  calculation: string
  source: string[]
  missing: string[]
  /** Short verdict shown under the number. */
  note: string
  /** Direction vs the previous window, when both are known. */
  changePercent?: number | null
}

export interface ProfitLeg {
  key: 'sales' | 'cogs' | 'ads' | 'profit'
  label: string
  value: number | null
  status: MetricStatus
  note: string
}

export interface ProfitabilityLeg {
  key: 'ads' | 'operations' | 'cash'
  label: string
  /** Share of the revenue this leg consumes (0..1), null when unknown. */
  share: number | null
  status: MetricStatus
  detail: string
}

export interface MonthHealth {
  /** danger ⇒ do not spend more; caution ⇒ fix something; healthy. */
  level: 'danger' | 'caution' | 'healthy' | 'unknown'
  headline: string
  detail: string
  /** The signals behind the verdict — all real, none invented. */
  signals: { key: string; label: string; value: string; level: 'good' | 'attention' | 'critical' | 'unknown' }[]
}

export interface OverviewResult {
  window: BusinessOverview['window']
  cards: OverviewCard[]
  /** The "profit cockpit" breakdown: sales → COGS → ads → net profit. */
  profitBreakdown: {
    legs: ProfitLeg[]
    /** True when the profit line is a number and not a withheld value. */
    profitKnown: boolean
    /** The reason the profit is withheld, when it is. */
    blocker: string | null
    note: string
  }
  /** Daily revenue/orders/profit series — profit is null until computable. */
  trend: { date: string; revenue: number; orders: number; profit: number | null }[]
  profitability: ProfitabilityLeg[]
  monthHealth: MonthHealth
  /** The product with the most revenue in the window (real). */
  strongest: { name: string; revenue: number; units: number } | null
  /** The biggest risk, taken from the decisions engine when available. */
  mainRisk: { title: string; detail: string; href: string } | null
  previous: { revenue: number | null; from: string | null; to: string | null } | null
}

function pct(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null
  return Math.round(n * 1000) / 1000
}

/** Build the six headline cards. */
export function buildOverviewCards(
  overview: BusinessOverview,
  analytics: AnalyticsResult
): OverviewCard[] {
  const byKey = overview.byKey
  const revenue = byKey.revenue?.value ?? null
  const deliveredRevenue = byKey.delivered_revenue?.value ?? null
  const netProfit = byKey.net_profit
  const adSpend = byKey.advertising_spend
  const cashCollected = byKey.cash_collected
  const deliveryRate = byKey.delivery_rate
  const undelivered = byKey.undelivered_orders?.value ?? null
  const deliveredOrders = byKey.delivered_orders?.value ?? null

  const cards: OverviewCard[] = []

  /* 1 — PROFIT */
  cards.push({
    key: 'profit',
    label: 'صافي الربح',
    value: netProfit?.value ?? null,
    unit: 'currency',
    status: netProfit?.provenance.status ?? 'unavailable',
    calculation: netProfit?.provenance.calculation ?? 'المبيعات − التكاليف',
    source: netProfit?.provenance.source ?? [],
    missing: netProfit?.provenance.missing ?? ['بيانات التكاليف غير متاحة'],
    note:
      netProfit?.provenance.status === 'actual'
        ? 'ربح محتسب من سجلات كاملة'
        : `محجوب: ${(netProfit?.provenance.missing ?? []).join(' · ')}`,
    changePercent: netProfit?.changePercent ?? null,
  })

  /* 2 — DELIVERED ROAS */
  const roasPossible = adSpend?.value !== null && adSpend?.value !== undefined && deliveredRevenue !== null
  cards.push({
    key: 'delivered_roas',
    label: 'ROAS المُسلَّم',
    value:
      roasPossible && adSpend!.value !== null && adSpend!.value > 0
        ? round2((deliveredRevenue as number) / (adSpend!.value as number))
        : null,
    unit: 'ratio',
    status: roasPossible ? 'actual' : 'unavailable',
    calculation: 'المبيعات المُسلَّمة ÷ الإنفاق الإعلاني',
    source: roasPossible ? ['orders', 'collection_deductions'] : [],
    missing: roasPossible
      ? []
      : ['لا يوجد اتصال بإعلانات مدفوعة — لا يمكن حساب العائد على الإنفاق الإعلاني'],
    note: roasPossible
      ? 'العائد محسوب على المبيعات المُسلَّمة فقط (لا على الطلبات غير المؤكدة)'
      : 'غير متاح: لا يوجد اتصال بإعلانات مدفوعة (Meta / TikTok / Google)',
  })

  /* 3 — PROFIT PER ORDER */
  const profitKnown = netProfit?.provenance.status === 'actual' && netProfit.value !== null
  const divisor = deliveredOrders && deliveredOrders > 0 ? deliveredOrders : byKey.total_orders?.value ?? null
  cards.push({
    key: 'profit_per_order',
    label: 'الربح لكل طلب',
    value:
      profitKnown && divisor && divisor > 0 ? round2((netProfit!.value as number) / divisor) : null,
    unit: 'currency',
    status: profitKnown ? 'actual' : 'incomplete',
    calculation: 'صافي الربح ÷ عدد الطلبات المحتسبة',
    source: ['orders', 'order_items', 'products'],
    missing: profitKnown
      ? []
      : ['صافي الربح محجوب — لا يمكن تقسيمه على الطلبات'],
    note: profitKnown
      ? `على ${divisor} طلب محتسب`
      : 'محجوب: صافي الربح غير محتسب بعد',
  })

  /* 4 — RTO EXPOSURE: the money sitting in the pipe (COD reality) */
  const openValue =
    revenue !== null && deliveredRevenue !== null ? round2(revenue - deliveredRevenue) : null
  cards.push({
    key: 'rto_exposure',
    label: 'تعرّض الإرجاع (RTO)',
    value: openValue,
    unit: 'currency',
    status: openValue === null ? 'unavailable' : 'actual',
    calculation: 'المبيعات المحتسبة − مبيعات الطلبات المُسلَّمة',
    source: ['orders'],
    missing:
      undelivered !== null
        ? [`${undelivered} طلب لم يُسلَّم بعد — كل طلب قد يعود إلى_origin أو يُحصَّل`]
        : [],
    note:
      openValue === null
        ? 'غير متاح'
        : `قيمة ${undelivered ?? 0} طلب لم يُسلَّم بعد — أعلى مبلغ يمكن فقده أو تأخّره`,
  })

  /* 5 — CASH MISSING */
  const cashKnown = cashCollected?.provenance.status === 'actual' && cashCollected.value !== null
  cards.push({
    key: 'cash_missing',
    label: 'النقد الناقص',
    value:
      cashKnown && revenue !== null ? round2(Math.max(0, revenue - (cashCollected!.value as number))) : null,
    unit: 'currency',
    status: cashKnown ? 'actual' : 'unavailable',
    calculation: 'المبيعات المحتسبة − المحصّل فعليًا من شركات الشحن',
    source: cashKnown ? ['orders', 'collection_batches'] : [],
    missing: cashKnown
      ? []
      : ['لا توجد دفعات تحصيل مسجّلة — لا يمكن معرفة النقد الذي لم يصل'],
    note: cashKnown
      ? 'المبيعات المحتسبة مقارنةً بالمحصّل فعليًا'
      : 'غير متاح: لا توجد دفعات تحصيل مسجّلة',
  })

  /* 6 — DELIVERY (the closest honest stand-in for a "health" number) */
  cards.push({
    key: 'delivery_rate',
    label: 'معدل التسليم',
    value: deliveryRate?.value ?? null,
    unit: 'percent',
    status: deliveryRate?.provenance.status ?? 'unavailable',
    calculation: deliveryRate?.provenance.calculation ?? 'الطلبات المُسلَّمة ÷ الطلبات المحتسبة',
    source: deliveryRate?.provenance.source ?? ['orders'],
    missing: deliveryRate?.provenance.missing ?? [],
    note:
      deliveryRate?.value === 0
        ? 'لا يوجد طلب مُسلَّم واحد في الفترة — كل المبيعات ما زالت على-paper'
        : (deliveryRate?.provenance.calculation ?? ''),
  })

  return cards
}

/** The sales → COGS → ads → net profit breakdown. */
export function buildProfitBreakdown(
  overview: BusinessOverview,
  analytics: AnalyticsResult
): OverviewResult['profitBreakdown'] {
  const byKey = overview.byKey
  const revenue = byKey.revenue
  const cogs = byKey.product_costs
  const ads = byKey.advertising_spend
  const profit = byKey.net_profit

  const legs: ProfitLeg[] = [
    {
      key: 'sales',
      label: 'إجمالي المبيعات',
      value: revenue?.value ?? null,
      status: revenue?.provenance.status ?? 'unavailable',
      note: revenue?.provenance.calculation ?? '',
    },
    {
      key: 'cogs',
      label: 'تكلفة المنتجات',
      value: cogs?.value ?? null,
      status: cogs?.provenance.status ?? 'unavailable',
      note: (cogs?.provenance.missing ?? []).join(' · ') || cogs?.provenance.calculation || '',
    },
    {
      key: 'ads',
      label: 'مصروف الإعلانات',
      value: ads?.value ?? null,
      status: ads?.provenance.status ?? 'unavailable',
      note: (ads?.provenance.missing ?? []).join(' · ') || ads?.provenance.calculation || '',
    },
    {
      key: 'profit',
      label: 'صافي الربح',
      value: profit?.value ?? null,
      status: profit?.provenance.status ?? 'unavailable',
      note: (profit?.provenance.missing ?? []).join(' · ') || profit?.provenance.calculation || '',
    },
  ]

  const profitKnown = profit?.provenance.status === 'actual' && profit.value !== null
  const missing = profit?.provenance.missing ?? []
  return {
    legs,
    profitKnown,
    blocker: profitKnown ? null : missing.join(' · ') || 'بيانات التكاليف غير متاحة',
    note: profitKnown
      ? 'كل المدخلات موجودة — الرقم محتسب من السجلات.'
      : 'الربح لا يُعرض حتى تكون كل المدخلات مسجّلة — الرقم الناقص ليس ربحاً.',
  }
}

/** ADS / OPERATIONS / CASH — where the money goes, as far as the data allows. */
export function buildProfitabilityLegs(
  overview: BusinessOverview
): ProfitabilityLeg[] {
  const byKey = overview.byKey
  const revenue = byKey.revenue?.value ?? null
  const ads = byKey.advertising_spend
  const shipping = byKey.shipping_cost
  const expenses = byKey.operating_expenses
  const cash = byKey.cash_collected

  const share = (v: number | null | undefined) =>
    revenue && revenue > 0 && typeof v === 'number' ? pct(v / revenue) : null

  const opsCost =
    typeof shipping?.value === 'number' && typeof expenses?.value === 'number'
      ? round2((shipping.value as number) + (expenses.value as number))
      : typeof shipping?.value === 'number'
        ? (shipping.value as number)
        : typeof expenses?.value === 'number'
          ? (expenses.value as number)
          : null

  return [
    {
      key: 'ads',
      label: 'الإعلانات',
      share: share(ads?.value),
      status: ads?.provenance.status ?? 'unavailable',
      detail:
        ads?.provenance.status === 'actual'
          ? 'الإنفاق الإعلاني مقروء من المنصة المتصلة'
          : 'غير متاح: لا يوجد اتصال بإعلانات مدفوعة',
    },
    {
      key: 'operations',
      label: 'التشغيل',
      share: share(opsCost),
      status:
        shipping?.provenance.status === 'actual' || expenses?.provenance.status === 'actual'
          ? shipping?.provenance.status === 'actual'
            ? 'actual'
            : 'estimated'
          : 'unavailable',
      detail:
        opsCost === null
          ? 'غير متاح: لا توجد تكلفة شحن ولا مصروفات مسجّلة'
          : 'تكلفة الشحن + المصروفات التشغيلية',
    },
    {
      key: 'cash',
      label: 'النقد',
      share: share(cash?.value),
      status: cash?.provenance.status ?? 'unavailable',
      detail:
        cash?.provenance.status === 'actual'
          ? 'المحصّل فعليًا من شركات الشحن'
          : 'غير متاح: لا توجد دفعات تحصيل مسجّلة',
    },
  ]
}

/**
 * Month health — can the store spend more right now?
 *
 * The verdict is derived from real operational signals only. It never uses a
 * made-up composite score: each signal is published next to the verdict.
 */
export function buildMonthHealth(overview: BusinessOverview): MonthHealth {
  const byKey = overview.byKey
  const delivery = byKey.delivery_rate
  const profit = byKey.net_profit
  const cash = byKey.cash_collected
  const undelivered = byKey.undelivered_orders?.value ?? null
  const total = byKey.total_orders?.value ?? null
  const completeness = byKey.data_completeness

  const signals: MonthHealth['signals'] = []
  let level: MonthHealth['level'] = 'unknown'

  const deliveryValue = delivery?.value ?? null
  if (deliveryValue === null) {
    signals.push({
      key: 'delivery',
      label: 'التسليم',
      value: 'غير متاح',
      level: 'unknown',
    })
  } else if (deliveryValue === 0) {
    signals.push({ key: 'delivery', label: 'التسليم', value: '0% — لا يوجد تسليم', level: 'critical' })
    level = 'danger'
  } else if (deliveryValue < 50) {
    signals.push({
      key: 'delivery',
      label: 'التسليم',
      value: `${Math.round(deliveryValue)}%`,
      level: 'attention',
    })
    level = (level as string) === 'danger' ? 'danger' : 'caution'
  } else {
    signals.push({ key: 'delivery', label: 'التسليم', value: `${Math.round(deliveryValue)}%`, level: 'good' })
  }

  const profitStatus = profit?.provenance.status ?? 'unavailable'
  if (profitStatus === 'actual') {
    signals.push({ key: 'margin', label: 'الهامش', value: 'محسوب', level: 'good' })
    if ((level as string) === 'unknown') level = 'healthy'
  } else {
    signals.push({
      key: 'margin',
      label: 'الهامش',
      value: 'غير محسوب — التكاليف ناقصة',
      level: 'attention',
    })
    if ((level as string) === 'unknown') level = 'caution'
  }

  if (cash?.provenance.status === 'actual') {
    signals.push({ key: 'cash', label: 'التحصيل', value: 'مسجّل', level: 'good' })
  } else {
    signals.push({ key: 'cash', label: 'التحصيل', value: 'لا توجد دفعات تحصيل', level: 'attention' })
    if ((level as string) === 'unknown') level = 'caution'
  }

  if (undelivered !== null && total !== null && total > 0 && undelivered / total > 0.5) {
    signals.push({
      key: 'backlog',
      label: 'التراكم',
      value: `${Math.round((undelivered / total) * 100)}% من الطلبات لم تُسلَّم`,
      level: 'attention',
    })
    if (level === 'healthy') level = 'caution'
  }

  const completenessValue = completeness?.value ?? null
  if (completenessValue !== null && completenessValue < 0.5 && level !== 'danger') {
    signals.push({
      key: 'data',
      label: 'اكتمال البيانات',
      value: `${Math.round(completenessValue * 100)}%`,
      level: 'attention',
    })
  }

  const headline =
    level === 'danger'
      ? 'التوسّع خطير الآن'
      : level === 'caution'
        ? 'يُفضّل الإصلاح قبل التوسع'
        : level === 'healthy'
          ? 'الوضع مستقر'
          : 'لا يمكن الحكم'

  const detail =
    level === 'danger'
      ? 'التسليم أو الهامش معطّل — أصلح قبل أن تزيد الإنفاق.'
      : level === 'caution'
        ? 'هناك نقص في البيانات أو في التحصيل — أكمله قبل التوسع.'
        : level === 'healthy'
          ? 'التسليم والهامش والتحصيل كلها مكتملة في هذه الفترة.'
          : 'البيانات لا تكفي لحكم — أكمل التسجيل أولاً.'

  return { level, headline, detail, signals }
}

/** Assemble the whole overview payload. */
export function buildBusinessOverviewPage(
  overview: BusinessOverview,
  analytics: AnalyticsResult,
  options: { risk?: { title: string; detail: string; href: string } | null } = {}
): OverviewResult {
  const cards = buildOverviewCards(overview, analytics)
  const trend = overview.series.map(s => ({
    date: s.date,
    revenue: s.revenue,
    orders: s.orders,
    profit: s.profit,
  }))

  const top = overview.topProducts[0]
  const strongest = top
    ? { name: top.name, revenue: top.revenue, units: top.units }
    : null

  return {
    window: overview.window,
    cards,
    profitBreakdown: buildProfitBreakdown(overview, analytics),
    trend,
    profitability: buildProfitabilityLegs(overview),
    monthHealth: buildMonthHealth(overview),
    strongest,
    mainRisk: options.risk ?? null,
    previous: analytics.previous
      ? { revenue: analytics.previous.revenue, from: analytics.previous.from, to: analytics.previous.to }
      : null,
  }
}
