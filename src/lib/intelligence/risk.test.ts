import { describe, it, expect } from 'vitest'
import { assessOrderRisk, assessOrders, buildHistories } from './risk'

const NOW = new Date('2026-11-21T10:00:00.000Z')

function order(overrides: Partial<Parameters<typeof assessOrderRisk>[0]> = {}) {
  return {
    id: 'o1',
    orderNumber: 'EG-1',
    totalAmount: 300,
    createdAt: '2026-11-20T10:00:00.000Z',
    status: 'pending',
    paymentStatus: 'pending',
    phone: '01001234567',
    city: 'القاهرة',
    governorate: 'القاهرة',
    address: '15 شارع(nullptr)',
    ...overrides,
  }
}

describe('assessOrderRisk', () => {
  it('scores a complete, fresh, first-time order as low risk', () => {
    const result = assessOrderRisk(order(), undefined, NOW)
    expect(result.score).toBe(0)
    expect(result.category).toBe('low')
    expect(result.requiresHumanReview).toBe(true)
  })

  it('flags a missing phone and a missing address', () => {
    const result = assessOrderRisk(
      order({ phone: null, city: null, governorate: null, address: null }),
      undefined,
      NOW
    )
    const keys = result.signals.map(s => s.key)
    expect(keys).toContain('missing_phone')
    expect(keys).toContain('missing_address')
    expect(result.score).toBeGreaterThanOrEqual(40)
  })

  it('weighs the customer refusal history heavily', () => {
    const result = assessOrderRisk(
      order(),
      { orders: 4, delivered: 1, returned: 1, refused: 2, cancelled: 0, averageOrderValue: 200 },
      NOW
    )
    expect(result.signals.map(s => s.key)).toContain('refusal_history')
    expect(result.score).toBeGreaterThanOrEqual(35)
    expect(result.confidence).toBe('medium')
  })

  it('says the data is limited when there is no delivery history at all', () => {
    const result = assessOrderRisk(order(), undefined, NOW)
    expect(result.dataLimited).toBe(true)
    expect(result.confidence).toBe('low')
    expect(result.recommendation).toContain('لا يوجد تاريخ تسليم')
  })

  it('flags an ageing order that never left', () => {
    const result = assessOrderRisk(
      order({ createdAt: '2026-10-20T10:00:00.000Z' }),
      undefined,
      NOW
    )
    expect(result.signals.map(s => s.key)).toContain('ageing')
  })

  it('flags an order far above the customer average', () => {
    const result = assessOrderRisk(
      order({ totalAmount: 5000 }),
      { orders: 3, delivered: 3, returned: 0, refused: 0, cancelled: 0, averageOrderValue: 300 },
      NOW
    )
    expect(result.signals.map(s => s.key)).toContain('value_outlier')
  })

  it('never produces a score above 100', () => {
    const result = assessOrderRisk(
      order({ phone: null, city: null, governorate: null, address: null, createdAt: '2026-01-01T00:00:00.000Z' }),
      { orders: 9, delivered: 1, returned: 2, refused: 6, cancelled: 0, averageOrderValue: 10 },
      NOW
    )
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.score).toBeGreaterThanOrEqual(0)
  })
})

describe('assessOrders', () => {
  it('summarises the exposure and tells the truth about readiness', () => {
    const orders = [
      order({ id: 'a' }),
      order({
        id: 'b',
        phone: null,
        city: null,
        governorate: null,
        address: null,
        totalAmount: 1000,
        createdAt: '2026-09-01T10:00:00.000Z',
      }),
    ]
    const summary = assessOrders(orders, new Map(), NOW)
    expect(summary.assessments.length).toBe(2)
    expect(summary.dataReadiness.withDeliveryHistory).toBe(0)
    expect(summary.dataReadiness.message).toContain('لا يوجد أي طلب مُسلَّم')
    expect(summary.valueAtRisk).toBeGreaterThan(0)
  })
})

describe('buildHistories', () => {
  it('groups the orders by phone and computes the average value', () => {
    const histories = buildHistories([
      { ...order({ id: '1', totalAmount: 100 }), delivered: true },
      { ...order({ id: '2', totalAmount: 300 }), returned: true },
    ])
    const history = histories.get('01001234567')!
    expect(history.orders).toBe(2)
    expect(history.delivered).toBe(1)
    expect(history.returned).toBe(1)
    expect(history.averageOrderValue).toBe(200)
  })
})
