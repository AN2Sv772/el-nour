/**
 * Unit tests for the pure financial engine — the approved business rules:
 *  - Provisional profit = revenue − COGS (historical snapshots) − expenses
 *  - Cancelled/returned orders excluded from provisional sales
 *  - Reconciled profit = provisional − returned-orders revenue estimate
 *    + returned products value (stock recovered at cost)
 *  - wa.me deep-link normalization for Egyptian numbers
 */
import { describe, it, expect } from 'vitest'
import { computeProvisional, computeReconciled, buildWaLink } from '@/lib/finance'

const orders = [
  { id: 'o1', total_amount: 1000, shipping_fee: 30, status: 'pending' },
  { id: 'o2', total_amount: 500, shipping_fee: 30, status: 'delivered' },
  { id: 'o3', total_amount: 700, shipping_fee: 30, status: 'cancelled' }, // excluded
] as never

const items = [
  { order_id: 'o1', quantity: 2, unit_cost: 200 },            // 400
  { order_id: 'o2', quantity: 1, unit_cost: null },           // fallback 150 → 150
  { order_id: 'o3', quantity: 5, unit_cost: 999 },            // excluded (cancelled)
] as never

describe('computeProvisional', () => {
  const result = computeProvisional(
    orders,
    items,
    [{ amount: 100, category: 'packaging' }, { amount: 50, category: 'shipping', voided_at: null }],
    { p1: 150 },
    { o2: 'p1' }
  )

  it('excludes cancelled orders from sales', () => {
    expect(result.orders_count).toBe(2)
    expect(result.provisional_sales).toBe(1500)
  })

  it('uses historical unit_cost snapshots with product-cost fallback', () => {
    // o1: 2×200=400 (snapshot) + o2: 1×150 (fallback) = 550
    expect(result.provisional_cogs).toBe(550)
  })

  it('sums only active (non-void) expenses', () => {
    expect(result.expenses_total).toBe(150)
  })

  it('provisional profit = sales − cogs − expenses', () => {
    expect(result.provisional_profit).toBe(1500 - 550 - 150)
  })
})

describe('computeReconciled', () => {
  const provisional = computeProvisional(orders, items, [], { p1: 150 }, { o2: 'p1' })

  it('returns-order revenue reversal is count × avg order value (estimate)', () => {
    const r = computeReconciled({ provisional, returnedOrdersCount: 1, returnedItems: [] })
    // avg = 1500/2 = 750
    expect(r.returned_orders_value).toBe(750)
    expect(r.reconciled_profit).toBe(provisional.provisional_profit - 750)
  })

  it('physically received products recover their cost into stock', () => {
    const r = computeReconciled({
      provisional,
      returnedOrdersCount: 1,
      returnedItems: [{ quantity_returned: 2, unit_cost: 200 }],
    })
    expect(r.returned_products_value).toBe(400)
    expect(r.reconciled_profit).toBe(provisional.provisional_profit - 750 + 400)
  })

  it('zero returns → reconciled equals provisional', () => {
    const r = computeReconciled({ provisional, returnedOrdersCount: 0, returnedItems: [] })
    expect(r.reconciled_profit).toBe(provisional.provisional_profit)
  })

  it('negative/zero quantities are not counted', () => {
    const r = computeReconciled({
      provisional,
      returnedOrdersCount: 0,
      returnedItems: [{ quantity_returned: -3, unit_cost: 100 }],
    })
    expect(r.returned_products_value).toBe(0)
  })
})

describe('buildWaLink (Egyptian normalization)', () => {
  it('local 0-prefixed mobile', () => {
    expect(buildWaLink('01034567890')).toBe('https://wa.me/201034567890')
  })
  it('already international +20', () => {
    expect(buildWaLink('+20 103 456 7890')).toBe('https://wa.me/201034567890')
  })
  it('20 prefix without plus', () => {
    expect(buildWaLink('201034567890')).toBe('https://wa.me/201034567890')
  })
  it('10 digits without leading zero', () => {
    expect(buildWaLink('1034567890')).toBe('https://wa.me/201034567890')
  })
  it('non-Egyptian international number passes through', () => {
    expect(buildWaLink('+971501234567')).toBe('https://wa.me/971501234567')
  })
  it('invalid input returns null', () => {
    expect(buildWaLink('')).toBeNull()
    expect(buildWaLink('abc')).toBeNull()
  })
})
