/**
 * Tests for the decision rules.
 *
 * The rule under test: a decision fires only when the evidence justifies it,
 * and it always carries the numbers that justified it.
 */

import { describe, it, expect } from 'vitest'
import { evaluateDecisions, type DecisionsSnapshot } from './rules'

const NOW = new Date('2026-11-21T12:00:00.000Z')

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

function snapshot(overrides: Partial<DecisionsSnapshot> = {}): DecisionsSnapshot {
  return {
    window: { preset: 'last_30_days', label: 'آخر 30 يومًا', from: daysAgo(30), to: NOW.toISOString() },
    orders: [],
    countedOrders: 100,
    deliveredOrders: 80,
    backlog: { total: 20, value: 10000, olderThan30Days: 0, valueOlderThan30Days: 0, olderThan7Days: 0 },
    ordersWithPayment: 100,
    avgShippingFeeCollected: 30,
    fixedShippingFee: 30,
    hasCollections: true,
    hasReconciliation: true,
    expensesNotRecorded: false,
    adsConnected: true,
    blindProducts: [],
    blindRevenue: 0,
    topProductShare: 20,
    revenue: 100000,
    profitStated: true,
    now: NOW,
    ...overrides,
  }
}

describe('the rules', () => {
  it('says nothing when everything is in order', () => {
    expect(evaluateDecisions(snapshot())).toEqual([])
  })

  it('fires on an aged backlog and shows its value', () => {
    const decisions = evaluateDecisions(
      snapshot({
        backlog: { total: 200, value: 500000, olderThan30Days: 150, valueOlderThan30Days: 400000, olderThan7Days: 170 },
      })
    )
    const decision = decisions.find(d => d.id === 'aged_backlog')
    expect(decision).toBeDefined()
    expect(decision?.severity).toBe('critical')
    expect(decision?.why).toContain('150')
    expect(decision?.evidence.some(e => e.value.includes('400,000'))).toBe(true)
  })

  it('fires when nothing was delivered', () => {
    const decisions = evaluateDecisions(snapshot({ deliveredOrders: 0 }))
    const decision = decisions.find(d => d.id === 'no_deliveries')
    expect(decision?.severity).toBe('critical')
    expect(decision?.confidence).toBe('high')
  })

  it('fires when no payment is recorded on any order', () => {
    const decisions = evaluateDecisions(snapshot({ ordersWithPayment: 0 }))
    const decision = decisions.find(d => d.id === 'payments_not_recorded')
    expect(decision?.severity).toBe('critical')
  })

  it('fires when the configured shipping fee is far below what is collected', () => {
    const decisions = evaluateDecisions(
      snapshot({ avgShippingFeeCollected: 60, fixedShippingFee: 30 })
    )
    const decision = decisions.find(d => d.id === 'shipping_fee_underestimated')
    expect(decision).toBeDefined()
    expect(decision?.action.proposal?.payload.value).toBe(60)
  })

  it('does NOT fire on a shipping fee that is close to reality', () => {
    const decisions = evaluateDecisions(
      snapshot({ avgShippingFeeCollected: 32, fixedShippingFee: 30 })
    )
    expect(decisions.find(d => d.id === 'shipping_fee_underestimated')).toBeUndefined()
  })

  it('fires on products sold without a cost', () => {
    const decisions = evaluateDecisions(
      snapshot({
        blindProducts: [{ productId: 'p1', name: 'أ', units: 5, revenue: 20000 }],
        blindRevenue: 20000,
      })
    )
    const decision = decisions.find(d => d.id === 'missing_product_costs')
    expect(decision?.severity).toBe('critical')
    expect(decision?.impact).toBeNull()
  })

  it('fires when expenses are never recorded', () => {
    const decisions = evaluateDecisions(snapshot({ expensesNotRecorded: true }))
    expect(decisions.find(d => d.id === 'expenses_not_recorded')?.severity).toBe('critical')
  })

  it('fires when no ad platform is connected', () => {
    const decisions = evaluateDecisions(snapshot({ adsConnected: false }))
    const decision = decisions.find(d => d.id === 'ads_not_connected')
    expect(decision?.severity).toBe('info')
  })

  it('fires when there are no courier collections', () => {
    const decisions = evaluateDecisions(snapshot({ hasCollections: false }))
    expect(decisions.find(d => d.id === 'no_collections')?.severity).toBe('high')
  })

  it('fires on revenue concentration above 40%', () => {
    const decisions = evaluateDecisions(snapshot({ topProductShare: 65 }))
    expect(decisions.find(d => d.id === 'revenue_concentration')).toBeDefined()
  })

  it('sorts the most severe decision first', () => {
    const decisions = evaluateDecisions(
      snapshot({
        deliveredOrders: 0,
        expensesNotRecorded: true,
        adsConnected: false,
      })
    )
    expect(decisions[0].severity).toBe('critical')
    expect(decisions[decisions.length - 1].severity).toBe('info')
  })
})
