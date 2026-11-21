import { describe, it, expect } from 'vitest'
import { simulate } from './simulator'

const complete = {
  orders: 100,
  revenue: 50000,
  averageOrderValue: 500,
  productCost: 20000,
  shippingCost: 3000,
  operatingExpenses: 5000,
  adSpend: 5000,
  returnRate: 0.1,
  deliveryRate: 0.9,
  expensesNotRecorded: false,
}

const incomplete = {
  orders: 100,
  revenue: 50000,
  averageOrderValue: 500,
  productCost: null,
  shippingCost: 3000,
  operatingExpenses: null,
  adSpend: null,
  returnRate: null,
  deliveryRate: 0.9,
  expensesNotRecorded: true,
}

describe('simulate', () => {
  it('computes the baseline profit when every input exists', () => {
    const result = simulate(complete, [])
    expect(result.baseline.netProfit).toBe(17000)
    expect(result.scenario.netProfit).toBe(17000)
    expect(result.isProjection).toBe(true)
  })

  it('withholds the profit when the inputs are missing — and says why', () => {
    const result = simulate(incomplete, [])
    expect(result.baseline.netProfit).toBeNull()
    expect(result.scenario.netProfit).toBeNull()
    expect(result.limitations.join(' ')).toContain('محجوب')
  })

  it('raises revenue by 10% when the price rises by 10%', () => {
    const result = simulate(complete, [{ lever: 'price', change: 0.1 }])
    expect(result.scenario.revenue).toBe(55000)
    expect(result.scenario.profitDelta).toBe(5000)
    expect(result.assumptions.join(' ')).toContain('سعر البيع')
  })

  it('lowers the profit when the shipping cost rises', () => {
    const result = simulate(complete, [{ lever: 'shipping_cost', change: 0.5 }])
    expect(result.scenario.shippingCost).toBe(4500)
    expect(result.scenario.netProfit).toBe(15500)
  })

  it('reduces the revenue when the return rate goes up', () => {
    const result = simulate(complete, [{ lever: 'return_rate', change: 0.5 }])
    // 10% → 15% returns: 50,000 × 0.85
    expect(result.scenario.revenue).toBe(42500)
  })

  it('never produces a negative order count', () => {
    const result = simulate(complete, [{ lever: 'conversion', change: -2 }])
    expect(result.scenario.orders).toBe(0)
    expect(result.scenario.revenue).toBe(0)
  })

  it('computes the break-even and the maximum acquisition cost', () => {
    const result = simulate(complete, [])
    // contribution = 500 − 200 (cogs/order) − 30 (shipping/order) = 270
    expect(result.scenario.contributionPerOrder).toBe(270)
    // fixed = 5,000 expenses + 5,000 ads = 10,000 → 38 orders
    expect(result.scenario.breakEvenOrders).toBe(38)
    expect(result.scenario.maxAcceptableAcquisitionCost).toBe(270)
  })

  it('combines several levers', () => {
    const result = simulate(complete, [
      { lever: 'price', change: 0.1 },
      { lever: 'product_cost', change: 0.05 },
    ])
    expect(result.scenario.revenue).toBe(55000)
    expect(result.scenario.productCost).toBe(21000)
    // two lever assumptions + the standing 'prices are constant' assumption
    expect(result.assumptions.length).toBe(3)
  })

  it('lists the limitations of the simulation', () => {
    const result = simulate(incomplete, [{ lever: 'price', change: 0.1 }])
    expect(result.limitations.length).toBeGreaterThan(1)
  })
})
