/**
 * Tests for the metrics calculation layer.
 *
 * The cases that matter are the HONESTY cases: a metric must never publish a
 * number that its data does not support.
 */

import { describe, it, expect } from 'vitest'
import {
  computeBusinessMetrics,
  attachComparison,
  type MetricInputs,
} from './calculations'
import { previousWindow } from './engine'

const day = (d: string) => `${d}T12:00:00.000Z`

function inputs(overrides: Partial<MetricInputs> = {}): MetricInputs {
  return {
    orders: [],
    items: [],
    products: [],
    expenses: [],
    collections: [],
    collectionDeductions: [],
    reconciliations: [],
    advertising: null,
    fixedShippingFee: null,
    businessDate: (iso: string) => iso.slice(0, 10),
    ...overrides,
  }
}

describe('the metrics engine — sales', () => {
  it('counts only non-cancelled, non-returned orders as sales', () => {
    const result = computeBusinessMetrics(
      inputs({
        orders: [
          { id: '1', total_amount: 500, shipping_fee: 30, status: 'delivered', payment_status: 'paid', created_at: day('2026-11-01') },
          { id: '2', total_amount: 700, shipping_fee: 30, status: 'pending', payment_status: 'pending', created_at: day('2026-11-01') },
          { id: '3', total_amount: 900, shipping_fee: 30, status: 'cancelled', payment_status: 'pending', created_at: day('2026-11-01') },
          { id: '4', total_amount: 400, shipping_fee: 30, status: 'returned', payment_status: 'pending', created_at: day('2026-11-01') },
        ],
      })
    )
    expect(result.byKey.revenue.value).toBe(1200)
    expect(result.byKey.total_orders.value).toBe(2)
    expect(result.byKey.delivered_revenue.value).toBe(500)
    expect(result.byKey.cancelled_orders.value).toBe(1)
    expect(result.byKey.returned_orders.value).toBe(1)
  })

  it('computes the average order value from counted orders only', () => {
    const result = computeBusinessMetrics(
      inputs({
        orders: [
          { id: '1', total_amount: 1000, shipping_fee: 0, status: 'delivered', payment_status: 'paid', created_at: day('2026-11-01') },
          { id: '2', total_amount: 500, shipping_fee: 0, status: 'delivered', payment_status: 'paid', created_at: day('2026-11-01') },
          { id: '3', total_amount: 9000, shipping_fee: 0, status: 'cancelled', payment_status: 'pending', created_at: day('2026-11-01') },
        ],
      })
    )
    expect(result.byKey.average_order_value.value).toBe(750)
  })
})

describe('the metrics engine — the honesty rule', () => {
  it('withholds product costs when a line has no unit cost', () => {
    const result = computeBusinessMetrics(
      inputs({
        orders: [{ id: '1', total_amount: 500, shipping_fee: 0, status: 'delivered', payment_status: 'paid', created_at: day('2026-11-01') }],
        items: [{ order_id: '1', product_id: 'p1', quantity: 2, unit_cost: null }],
        products: [{ id: 'p1', name: 'منتج', sku: 'S1', price: 500, cost_price: 0, stock_quantity: 5, track_inventory: true }],
      })
    )
    const cogs = result.byKey.product_costs
    expect(cogs.value).toBeNull()
    expect(cogs.provenance.status).toBe('incomplete')
    expect(cogs.provenance.missing.join(' ')).toMatch(/بدون تكلفة/)
  })

  it('treats a zero cost as "unknown", not as "free"', () => {
    const result = computeBusinessMetrics(
      inputs({
        orders: [{ id: '1', total_amount: 500, shipping_fee: 0, status: 'delivered', payment_status: 'paid', created_at: day('2026-11-01') }],
        items: [{ order_id: '1', product_id: 'p1', quantity: 1, unit_cost: 0 }],
        products: [{ id: 'p1', name: 'منتج', sku: 'S1', price: 500, cost_price: 0, stock_quantity: 5, track_inventory: true }],
      })
    )
    expect(result.byKey.product_costs.value).toBeNull()
  })

  it('publishes product costs when every line has a known cost', () => {
    const result = computeBusinessMetrics(
      inputs({
        orders: [{ id: '1', total_amount: 500, shipping_fee: 0, status: 'delivered', payment_status: 'paid', created_at: day('2026-11-01') }],
        items: [{ order_id: '1', product_id: 'p1', quantity: 2, unit_cost: 120 }],
        products: [{ id: 'p1', name: 'منتج', sku: 'S1', price: 500, cost_price: 120, stock_quantity: 5, track_inventory: true }],
      })
    )
    expect(result.byKey.product_costs.value).toBe(240)
    expect(result.byKey.product_costs.provenance.status).toBe('actual')
  })

  it('marks advertising as unavailable when no platform is connected', () => {
    const result = computeBusinessMetrics(inputs())
    expect(result.byKey.advertising_spend.value).toBeNull()
    expect(result.byKey.advertising_spend.provenance.status).toBe('unavailable')
    expect(result.gaps.find(g => g.id === 'no_advertising_connection')).toBeTruthy()
  })

  it('never publishes net profit while an input is missing', () => {
    const result = computeBusinessMetrics(
      inputs({
        orders: [{ id: '1', total_amount: 500, shipping_fee: 0, status: 'delivered', payment_status: 'paid', created_at: day('2026-11-01') }],
        items: [{ order_id: '1', product_id: 'p1', quantity: 1, unit_cost: 100 }],
        products: [{ id: 'p1', name: 'منتج', sku: 'S1', price: 500, cost_price: 100, stock_quantity: 5, track_inventory: true }],
        advertising: null,
      })
    )
    expect(result.byKey.net_profit.value).toBeNull()
    expect(result.byKey.net_profit.provenance.status).toBe('incomplete')
    expect(result.byKey.net_profit.provenance.missing.join(' ')).toMatch(/الإعلانات/)
    // …but the honest subset is still published.
    expect(result.byKey.revenue_minus_expenses.value).toBe(500)
  })

  it('publishes net profit when every input exists', () => {
    const result = computeBusinessMetrics(
      inputs({
        orders: [{ id: '1', total_amount: 1000, shipping_fee: 50, status: 'delivered', payment_status: 'paid', created_at: day('2026-11-01') }],
        items: [{ order_id: '1', product_id: 'p1', quantity: 2, unit_cost: 100 }],
        products: [{ id: 'p1', name: 'منتج', sku: 'S1', price: 1000, cost_price: 100, stock_quantity: 5, track_inventory: true }],
        expenses: [{ amount: 80, expense_date: '2026-11-01', category: 'ads', voided_at: null }],
        advertising: { spend: 120, source: 'meta' },
        collectionDeductions: [{ batch_id: 'b1', amount: 40, label: 'رسوم شحن' }],
        collections: [{ expected_amount: 1000, received_amount: 960, status: 'partial' }],
        fixedShippingFee: 40,
      })
    )
    // 1000 − 200 − 40 − 120 − 80 − 0 (no returns) = 560
    expect(result.byKey.net_profit.value).toBe(560)
    expect(result.byKey.net_profit.provenance.status).toBe('actual')
  })

  it('excludes voided expenses', () => {
    const result = computeBusinessMetrics(
      inputs({
        expenses: [
          { amount: 100, expense_date: '2026-11-01', category: 'rent', voided_at: null },
          { amount: 50, expense_date: '2026-11-01', category: 'rent', voided_at: '2026-11-02' },
        ],
      })
    )
    expect(result.byKey.operating_expenses.value).toBe(100)
  })

  it('estimates the shipping cost from the fixed fee when there are no collections', () => {
    const result = computeBusinessMetrics(
      inputs({
        orders: [{ id: '1', total_amount: 500, shipping_fee: 0, status: 'delivered', payment_status: 'paid', created_at: day('2026-11-01') }],
        fixedShippingFee: 40,
      })
    )
    expect(result.byKey.shipping_cost.value).toBe(40)
    expect(result.byKey.shipping_cost.provenance.status).toBe('estimated')
  })

  it('withholds the inventory value when a product has no cost', () => {
    const result = computeBusinessMetrics(
      inputs({
        products: [
          { id: 'p1', name: 'أ', sku: 'A', price: 100, cost_price: 40, stock_quantity: 10, track_inventory: true },
          { id: 'p2', name: 'ب', sku: 'B', price: 200, cost_price: 0, stock_quantity: 5, track_inventory: true },
        ],
      })
    )
    expect(result.byKey.inventory_value.value).toBeNull()
    expect(result.byKey.inventory_units.value).toBe(15)
  })

  it('withholds the inventory when the store does not track stock at all', () => {
    const result = computeBusinessMetrics(
      inputs({
        products: [
          { id: 'p1', name: 'أ', sku: 'A', price: 100, cost_price: 40, stock_quantity: 0, track_inventory: false },
        ],
      })
    )
    expect(result.byKey.inventory_units.value).toBeNull()
    expect(result.byKey.inventory_units.provenance.status).toBe('unavailable')
    expect(result.byKey.inventory_value.value).toBeNull()
    expect(result.gaps.find(g => g.id === 'inventory_not_tracked')).toBeTruthy()
  })

  it('does not publish zero expenses when nothing is ever recorded', () => {
    const result = computeBusinessMetrics(inputs({ expensesTableIsEmpty: true }))
    expect(result.byKey.operating_expenses.value).toBeNull()
    expect(result.byKey.operating_expenses.provenance.status).toBe('incomplete')
    expect(result.gaps.find(g => g.id === 'expenses_not_recorded')).toBeTruthy()
  })

  it('does not publish zero collected cash when there are no batches', () => {
    const result = computeBusinessMetrics(inputs())
    expect(result.byKey.cash_collected.value).toBeNull()
    expect(result.byKey.cash_collected.provenance.status).toBe('unavailable')
  })
})

describe('the metrics engine — cash and returns', () => {
  it('computes cash held by couriers as expected minus received', () => {
    const result = computeBusinessMetrics(
      inputs({
        collections: [{ expected_amount: 5000, received_amount: 3000, status: 'partial' }],
      })
    )
    expect(result.byKey.cash_collected.value).toBe(3000)
    expect(result.byKey.cash_held_by_couriers.value).toBe(2000)
  })

  it('estimates the returned-orders loss and labels it as an estimate', () => {
    const result = computeBusinessMetrics(
      inputs({
        orders: [{ id: '1', total_amount: 1000, shipping_fee: 0, status: 'delivered', payment_status: 'paid', created_at: day('2026-11-01') }],
        reconciliations: [{ business_date: '2026-11-01', returned_orders_count: 2 }],
      })
    )
    expect(result.byKey.returned_loss.value).toBe(2000)
    expect(result.byKey.returned_loss.provenance.status).toBe('estimated')
  })

  it('raises an alert when courier cash is outstanding', () => {
    const result = computeBusinessMetrics(
      inputs({
        collections: [{ expected_amount: 5000, received_amount: 3000, status: 'partial' }],
      })
    )
    expect(result.alerts.find(a => a.id === 'courier_cash_outstanding')).toBeTruthy()
  })
})

describe('the metrics engine — products and series', () => {
  it('reports a null margin when the cost is unknown', () => {
    const result = computeBusinessMetrics(
      inputs({
        orders: [{ id: '1', total_amount: 500, shipping_fee: 0, status: 'delivered', payment_status: 'paid', created_at: day('2026-11-01') }],
        items: [{ order_id: '1', product_id: 'p1', quantity: 1, unit_cost: null }],
        products: [{ id: 'p1', name: 'منتج', sku: 'S1', price: 500, cost_price: 0, stock_quantity: 5, track_inventory: true }],
      })
    )
    expect(result.topProducts[0].margin).toBeNull()
    expect(result.topProducts[0].status).toBe('incomplete')
  })

  it('lists only genuinely negative margins as loss-making', () => {
    const result = computeBusinessMetrics(
      inputs({
        orders: [{ id: '1', total_amount: 100, shipping_fee: 0, status: 'delivered', payment_status: 'paid', created_at: day('2026-11-01') }],
        items: [{ order_id: '1', product_id: 'p1', quantity: 1, unit_cost: 300 }],
        products: [{ id: 'p1', name: 'خاسر', sku: 'L', price: 100, cost_price: 300, stock_quantity: 1, track_inventory: true }],
      })
    )
    expect(result.losingProducts).toHaveLength(1)
    expect(result.losingProducts[0].margin).toBeLessThan(0)
  })

  it('marks a day in the series as having no profit when its cost is unknown', () => {
    const result = computeBusinessMetrics(
      inputs({
        orders: [{ id: '1', total_amount: 500, shipping_fee: 0, status: 'delivered', payment_status: 'paid', created_at: day('2026-11-01') }],
        items: [{ order_id: '1', product_id: 'p1', quantity: 1, unit_cost: null }],
        products: [{ id: 'p1', name: 'منتج', sku: 'S1', price: 500, cost_price: 0, stock_quantity: 5, track_inventory: true }],
      })
    )
    expect(result.series[0].profit).toBeNull()
  })
})

describe('comparison with the previous period', () => {
  it('computes the change percentage', () => {
    const metrics = [
      {
        key: 'revenue',
        label: 'x',
        value: 120,
        unit: 'currency' as const,
        provenance: { status: 'actual' as const, calculation: '', source: [], missing: [], completeness: 1 },
      },
    ]
    const [metric] = attachComparison(metrics, { revenue: 100 })
    expect(metric.previous).toBe(100)
    expect(metric.changePercent).toBe(20)
  })

  it('leaves the change empty when the previous value was zero', () => {
    const metrics = [
      {
        key: 'revenue',
        label: 'x',
        value: 120,
        unit: 'currency' as const,
        provenance: { status: 'actual' as const, calculation: '', source: [], missing: [], completeness: 1 },
      },
    ]
    const [metric] = attachComparison(metrics, { revenue: 0 })
    expect(metric.changePercent).toBeNull()
  })

  it('derives the previous window as the same length immediately before', () => {
    const prev = previousWindow('2026-11-01T00:00:00.000Z', '2026-11-08T23:59:59.999Z')
    expect(prev.from).toBe('2026-10-24T00:00:00.000Z')
    expect(prev.to).toBe('2026-10-31T23:59:59.999Z')
  })

  it('has no previous window for an unbounded range', () => {
    expect(previousWindow(null, null)).toEqual({ from: null, to: null })
  })
})
