/**
 * Tests for the finance & analytics layer.
 *
 * The rule under test: a subtotal is withheld whenever one of its inputs is
 * not a fact, and the statement never contradicts the metric set.
 */

import { describe, it, expect } from 'vitest'
import {
  buildCashFlow,
  buildProductEconomics,
  buildProfitAndLoss,
} from './finance'
import type { BusinessOverview, Metric, MetricStatus, ProductPerformance } from '@/lib/metrics/types'

function metric(
  key: string,
  value: number | null,
  status: MetricStatus = 'actual',
  missing: string[] = []
): Metric {
  return {
    key,
    label: key,
    value,
    unit: 'currency',
    provenance: {
      status,
      calculation: 'حساب',
      source: ['orders'],
      missing: status === 'actual' ? [] : missing.length ? missing : ['ناقص'],
      completeness: 1,
    },
  }
}

function overview(byKey: Record<string, Metric>): BusinessOverview {
  return {
    window: {
      preset: 'this_month',
      label: 'هذا الشهر',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-21T21:59:59.999Z',
      previousFrom: null,
      previousTo: null,
      timezone: 'Africa/Cairo',
      computedAt: '2026-11-21T12:00:00.000Z',
    },
    metrics: Object.values(byKey),
    byKey,
    products: [],
    topProducts: [],
    losingProducts: [],
    series: [],
    alerts: [],
    health: [],
    gaps: [],
  }
}

const COMPLETE_METRICS: Record<string, Metric> = {
  revenue: metric('revenue', 100000),
  product_costs: metric('product_costs', 60000),
  shipping_cost: metric('shipping_cost', 10000),
  advertising_spend: metric('advertising_spend', 5000),
  operating_expenses: metric('operating_expenses', 5000),
  returned_loss: metric('returned_loss', 2000, 'estimated'),
  net_profit: metric('net_profit', 20000),
}

describe('profit & loss', () => {
  it('draws the gross profit when the product costs are known', () => {
    const pnl = buildProfitAndLoss(overview(COMPLETE_METRICS))
    const gross = pnl.lines.find(l => l.key === 'gross_profit')
    expect(gross?.value).toBe(40000)
    expect(gross?.status).toBe('actual')
  })

  it('withholds the gross profit when the product costs are unknown', () => {
    const pnl = buildProfitAndLoss(
      overview({
        ...COMPLETE_METRICS,
        product_costs: metric('product_costs', null, 'incomplete', ['تكلفة المنتجات ناقصة']),
      })
    )
    const gross = pnl.lines.find(l => l.key === 'gross_profit')
    expect(gross?.value).toBeNull()
    expect(gross?.status).toBe('incomplete')
    expect(gross?.missing.length).toBeGreaterThan(0)
  })

  it('states the final profit only when the returned loss is known', () => {
    const pnl = buildProfitAndLoss(overview(COMPLETE_METRICS))
    expect(pnl.finalProfit).toBe(18000)
    expect(pnl.status).toBe('actual')
  })

  it('withholds the final profit when the returned loss is unknown', () => {
    const pnl = buildProfitAndLoss(
      overview({
        ...COMPLETE_METRICS,
        returned_loss: metric('returned_loss', null, 'unavailable', ['لا توجد تسويات يومية مسجّلة']),
      })
    )
    expect(pnl.finalProfit).toBeNull()
    expect(pnl.provisionalProfit).toBe(20000)
    expect(pnl.status).toBe('incomplete')
  })

  it('never contradicts the metric set', () => {
    const pnl = buildProfitAndLoss(overview(COMPLETE_METRICS))
    const provisional = pnl.lines.find(l => l.key === 'net_profit')
    expect(provisional?.value).toBe(COMPLETE_METRICS.net_profit.value)
  })

  it('marks the deduction lines', () => {
    const pnl = buildProfitAndLoss(overview(COMPLETE_METRICS))
    const costs = pnl.lines.filter(l => l.kind === 'cost')
    expect(costs.length).toBeGreaterThan(0)
    expect(costs.every(l => l.deduction === true)).toBe(true)
  })
})

describe('cash flow', () => {
  it('is unavailable — not zero — when no batch is recorded', () => {
    const flow = buildCashFlow({ batches: [], deductions: [], recognizedSales: 50000 })
    expect(flow.status).toBe('unavailable')
    expect(flow.totals.received).toBeNull()
    expect(flow.totals.outstanding).toBeNull()
  })

  it('computes the outstanding amount from the batches', () => {
    const flow = buildCashFlow({
      batches: [
        { id: 'b1', created_at: '2026-11-01T10:00:00Z', expected_amount: 50000, received_amount: 45000, status: 'partial' },
        { id: 'b2', created_at: '2026-11-10T10:00:00Z', expected_amount: 30000, received_amount: 30000, status: 'settled' },
      ],
      deductions: [{ batch_id: 'b1', amount: 2000 }],
      recognizedSales: 80000,
    })
    expect(flow.status).toBe('actual')
    expect(flow.totals.expected).toBe(80000)
    expect(flow.totals.received).toBe(75000)
    expect(flow.totals.outstanding).toBe(5000)
    expect(flow.totals.deductions).toBe(2000)
    expect(flow.batches[0].difference).toBe(-5000)
    expect(flow.cashBackedRatio).toBe(93.75)
  })

  it('flags a batch with a missing amount', () => {
    const flow = buildCashFlow({
      batches: [{ id: 'b1', created_at: '2026-11-01T10:00:00Z', expected_amount: null, received_amount: 100, status: null }],
      deductions: [],
      recognizedSales: 100,
    })
    expect(flow.status).toBe('incomplete')
    expect(flow.missing.length).toBeGreaterThan(0)
  })
})

describe('product economics', () => {
  const products: ProductPerformance[] = [
    { productId: 'p1', name: 'أ', sku: 'A', units: 10, revenue: 60000, cost: 30000, margin: 30000, marginPercent: 50, status: 'actual' },
    { productId: 'p2', name: 'ب', sku: 'B', units: 5, revenue: 40000, cost: 20000, margin: 20000, marginPercent: 50, status: 'actual' },
    { productId: 'p3', name: 'ج', sku: 'C', units: 3, revenue: 0, cost: 0, margin: null, marginPercent: null, status: 'incomplete' },
  ]

  it('computes the revenue share', () => {
    const economics = buildProductEconomics(products, 100000)
    expect(economics.products[0].revenueShare).toBe(60)
    expect(economics.products[1].revenueShare).toBe(40)
  })

  it('counts the revenue earned without a known cost', () => {
    const economics = buildProductEconomics(products, 100000)
    expect(economics.blindProductCount).toBe(1)
    expect(economics.blindRevenue).toBe(0)
    expect(economics.status).toBe('incomplete')
  })

  it('reports the concentration on the top products', () => {
    const economics = buildProductEconomics(products, 100000)
    expect(economics.concentration.top1Share).toBe(60)
    expect(economics.concentration.top3Share).toBe(100)
  })

  it('is fully actual when every sold product has a cost', () => {
    const economics = buildProductEconomics(products.slice(0, 2), 100000)
    expect(economics.status).toBe('actual')
    expect(economics.blindRevenue).toBeNull()
  })
})
