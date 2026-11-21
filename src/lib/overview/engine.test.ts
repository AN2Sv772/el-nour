import { describe, it, expect } from 'vitest'
import {
  buildOverviewCards,
  buildProfitBreakdown,
  buildProfitabilityLegs,
  buildMonthHealth,
  buildBusinessOverviewPage,
} from './engine'
import type { BusinessOverview, Metric } from '@/lib/metrics/types'
import type { AnalyticsResult } from '@/lib/analytics/engine'

/* ------------------------------------------------------------------ */
/* Fixtures                                                             */
/* ------------------------------------------------------------------ */

function metric(
  key: string,
  value: number | null,
  status: Metric['provenance']['status'],
  extra: Partial<Metric['provenance']> = {},
  unit: Metric['unit'] = 'currency'
): Metric {
  return {
    key,
    label: key,
    value,
    unit,
    provenance: {
      status,
      calculation: 'اختبار',
      source: ['orders'],
      missing: status === 'actual' ? [] : ['ناقص'],
      completeness: status === 'actual' ? 1 : 0.5,
      ...extra,
    },
  }
}

function makeOverview(overrides: Partial<Record<string, Metric>> = {}): BusinessOverview {
  const metrics: Metric[] = [
    metric('revenue', 315560, 'actual'),
    metric('delivered_revenue', 0, 'actual'),
    metric('total_orders', 741, 'actual', {}, 'count'),
    metric('delivered_orders', 0, 'actual', {}, 'count'),
    metric('undelivered_orders', 741, 'actual', {}, 'count'),
    metric('product_costs', null, 'incomplete', { missing: ['تكلفة المنتجات ناقصة'] }),
    metric('operating_expenses', null, 'incomplete', { missing: ['لا تُسجَّل مصروفات'] }),
    metric('advertising_spend', null, 'unavailable', { missing: ['لا يوجد اتصال بإعلانات مدفوعة'] }),
    metric('shipping_cost', 22230, 'estimated'),
    metric('net_profit', null, 'incomplete', { missing: ['تكلفة المنتجات ناقصة', 'مصروف الإعلانات غير متاح'] }),
    metric('cash_collected', null, 'unavailable', { missing: ['لا توجد دفعات تحصيل'] }),
    metric('delivery_rate', 0, 'actual', {}, 'percent'),
    metric('data_completeness', 0.3, 'actual', {}, 'percent'),
    ...Object.entries(overrides).map(([key, m]) => m as Metric),
  ]
  const byKey: Record<string, Metric> = {}
  for (const m of metrics) byKey[m.key] = m
  return {
    window: {
      preset: 'last_30_days',
      label: 'آخر 30 يومًا',
      from: '2026-10-22T00:00:00.000Z',
      to: '2026-11-21T00:00:00.000Z',
      previousFrom: null,
      previousTo: null,
      timezone: 'Africa/Cairo',
      computedAt: '2026-11-21T00:00:00.000Z',
    },
    metrics,
    byKey,
    alerts: [],
    health: [],
    gaps: [],
    topProducts: [
      { productId: 'p1', name: 'منتج 1', sku: 'A1', units: 120, revenue: 150000, cost: 0, margin: null, marginPercent: null, status: 'incomplete' },
    ],
    products: [],
    losingProducts: [],
    series: [
      { date: '2026-11-01', orders: 10, revenue: 5000, cost: 0, expenses: 0, profit: null },
      { date: '2026-11-02', orders: 12, revenue: 6000, cost: 0, expenses: 0, profit: null },
    ],
  }
}

const analytics = {
  previous: { from: '2026-09-22T00:00:00.000Z', to: '2026-10-22T00:00:00.000Z', revenue: 300000 },
} as unknown as AnalyticsResult

/* ------------------------------------------------------------------ */

describe('buildOverviewCards', () => {
  it('publishes the real numbers and withholds the ones it cannot compute', () => {
    const cards = buildOverviewCards(makeOverview(), analytics)
    const byKey = Object.fromEntries(cards.map(c => [c.key, c]))

    // Real, from the orders table.
    expect(byKey.rto_exposure.value).toBe(315560)
    expect(byKey.rto_exposure.status).toBe('actual')
    expect(byKey.delivery_rate.value).toBe(0)

    // Withheld, with the reason attached.
    expect(byKey.profit.value).toBeNull()
    expect(byKey.profit.status).toBe('incomplete')
    expect(byKey.profit.missing.join(' ')).toContain('تكلفة المنتجات')
    expect(byKey.delivered_roas.value).toBeNull()
    expect(byKey.delivered_roas.status).toBe('unavailable')
    expect(byKey.profit_per_order.value).toBeNull()
    expect(byKey.cash_missing.value).toBeNull()
  })

  it('computes the ROAS once an advertising spend exists', () => {
    const cards = buildOverviewCards(
      makeOverview({
        advertising_spend: metric('advertising_spend', 10000, 'actual'),
        delivered_revenue: metric('delivered_revenue', 50000, 'actual'),
      }),
      analytics
    )
    const roas = cards.find(c => c.key === 'delivered_roas')!
    expect(roas.value).toBe(5)
    expect(roas.status).toBe('actual')
  })

  it('never divides by a zero order count', () => {
    const cards = buildOverviewCards(
      makeOverview({
        net_profit: metric('net_profit', 1000, 'actual'),
        total_orders: metric('total_orders', 0, 'actual', {}, 'count'),
        delivered_orders: metric('delivered_orders', 0, 'actual', {}, 'count'),
      }),
      analytics
    )
    expect(cards.find(c => c.key === 'profit_per_order')!.value).toBeNull()
  })

  it('computes cash missing when the collections are recorded', () => {
    const cards = buildOverviewCards(
      makeOverview({ cash_collected: metric('cash_collected', 100000, 'actual') }),
      analytics
    )
    expect(cards.find(c => c.key === 'cash_missing')!.value).toBe(215560)
  })
})

describe('buildProfitBreakdown', () => {
  it('lists sales, cogs, ads and profit with their statuses', () => {
    const breakdown = buildProfitBreakdown(makeOverview(), analytics)
    expect(breakdown.legs.map(l => l.key)).toEqual(['sales', 'cogs', 'ads', 'profit'])
    expect(breakdown.legs[0].value).toBe(315560)
    expect(breakdown.profitKnown).toBe(false)
    expect(breakdown.blocker).toContain('تكلفة المنتجات')
    expect(breakdown.note).toContain('لا يُعرض')
  })

  it('marks the profit as known only when the metric is actual', () => {
    const breakdown = buildProfitBreakdown(
      makeOverview({ net_profit: metric('net_profit', 5000, 'actual') }),
      analytics
    )
    expect(breakdown.profitKnown).toBe(true)
    expect(breakdown.blocker).toBeNull()
  })
})

describe('buildProfitabilityLegs', () => {
  it('keeps ads and cash unavailable and shows the operations share', () => {
    const legs = buildProfitabilityLegs(makeOverview())
    const byKey = Object.fromEntries(legs.map(l => [l.key, l]))
    expect(byKey.ads.status).toBe('unavailable')
    expect(byKey.ads.share).toBeNull()
    expect(byKey.cash.status).toBe('unavailable')
    // shipping is estimated (22,230) → the operations share is an approximation
    expect(byKey.operations.share).toBeCloseTo(22230 / 315560, 3)
  })
})

describe('buildMonthHealth', () => {
  it('says scaling is dangerous when nothing is delivered', () => {
    const health = buildMonthHealth(makeOverview())
    expect(health.level).toBe('danger')
    expect(health.headline).toContain('خطير')
    expect(health.signals.some(s => s.key === 'delivery' && s.level === 'critical')).toBe(true)
  })

  it('is healthy only when delivery, margin and cash are all present', () => {
    const health = buildMonthHealth(
      makeOverview({
        delivery_rate: metric('delivery_rate', 92, 'actual', {}, 'percent'),
        net_profit: metric('net_profit', 5000, 'actual'),
        cash_collected: metric('cash_collected', 100000, 'actual'),
        undelivered_orders: metric('undelivered_orders', 10, 'actual', {}, 'count'),
        total_orders: metric('total_orders', 500, 'actual', {}, 'count'),
        data_completeness: metric('data_completeness', 1, 'actual', {}, 'percent'),
      })
    )
    expect(health.level).toBe('healthy')
    expect(health.headline).toContain('مستقر')
  })

  it('is cautious when the margin is unknown but the delivery works', () => {
    const health = buildMonthHealth(
      makeOverview({
        delivery_rate: metric('delivery_rate', 80, 'actual', {}, 'percent'),
        cash_collected: metric('cash_collected', 100000, 'actual'),
        undelivered_orders: metric('undelivered_orders', 10, 'actual', {}, 'count'),
        total_orders: metric('total_orders', 500, 'actual', {}, 'count'),
      })
    )
    expect(health.level).toBe('caution')
  })
})

describe('buildBusinessOverviewPage', () => {
  it('assembles the page payload and keeps the profit null in the trend', () => {
    const page = buildBusinessOverviewPage(makeOverview(), analytics, {
      risk: { title: 'لا يوجد تسليم', detail: '741 طلباً', href: '/decisions' },
    })
    expect(page.cards.length).toBe(6)
    expect(page.trend.every(t => t.profit === null)).toBe(true)
    expect(page.strongest?.name).toBe('منتج 1')
    expect(page.mainRisk?.href).toBe('/decisions')
    expect(page.previous?.revenue).toBe(300000)
  })
})
