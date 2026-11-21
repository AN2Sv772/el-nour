import { describe, it, expect } from 'vitest'
import { forecastDemand } from './forecast'

function series(values: number[]) {
  return values.map((v, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    orders: v,
    revenue: v * 100,
  }))
}

const base = {
  horizonDays: 7,
  averageOrderValue: 100,
  inventoryTracked: false,
}

describe('forecastDemand', () => {
  it('refuses to forecast with fewer than 7 days', () => {
    const result = forecastDemand({ ...base, series: series([1, 2, 3]) })
    expect(result.method).toBe('insufficient_data')
    expect(result.points).toHaveLength(0)
    expect(result.confidence).toBe('low')
    expect(result.limitations.join(' ')).toContain('بيانات')
  })

  it('forecasts a flat series at its level', () => {
    const result = forecastDemand({ ...base, series: series(Array(14).fill(10)) })
    // A perfectly flat series ties every method — the simplest one wins.
    expect(['naive', 'moving_average', 'linear_trend']).toContain(result.method)
    expect(result.points).toHaveLength(7)
    expect(result.points[0].orders).toBe(10)
    expect(result.points[0].revenue).toBe(1000)
  })

  it('publishes the measured error instead of pretending to be precise', () => {
    const result = forecastDemand({ ...base, series: series([10, 12, 11, 13, 12, 14, 13, 15, 14, 16]) })
    expect(result.backtestMape).not.toBeNull()
    expect(result.backtestDays).toBeGreaterThan(0)
    expect(result.limitations.join(' ')).toContain('MAPE')
  })

  it('gives a wide interval when the error is large', () => {
    const noisy = forecastDemand({
      ...base,
      series: series([5, 40, 8, 35, 6, 38, 7, 42, 9, 36]),
    })
    const point = noisy.points[0]
    expect(point.upper - point.orders).toBeGreaterThan(0)
    expect(point.lower).toBeLessThanOrEqual(point.orders)
  })

  it('never produces a negative order count', () => {
    const result = forecastDemand({ ...base, series: series([20, 18, 16, 14, 12, 10, 8, 6, 4, 2]) })
    expect(result.points.every(p => p.orders >= 0)).toBe(true)
  })

  it('does not compute a depletion date when the inventory is not tracked', () => {
    const result = forecastDemand({
      ...base,
      series: series(Array(10).fill(5)),
      productUnits: [{ productId: 'p1', name: 'منتج', units: 50, days: 10 }],
      stock: [{ productId: 'p1', name: 'منتج', stock: 20 }],
    })
    expect(result.products?.[0].depletionDate).toBeNull()
    expect(result.products?.[0].note).toContain('المخزون غير مُدار')
  })

  it('computes the depletion and reorder dates when the stock is tracked', () => {
    const result = forecastDemand({
      ...base,
      series: series(Array(10).fill(5)),
      inventoryTracked: true,
      productUnits: [{ productId: 'p1', name: 'منتج', units: 50, days: 10 }],
      stock: [{ productId: 'p1', name: 'منتج', stock: 100 }],
    })
    expect(result.products?.[0].unitsPerDay).toBe(5)
    expect(result.products?.[0].depletionDate).toBeTruthy()
    expect(result.products?.[0].reorderDate).toBeTruthy()
  })

  it('states its assumptions', () => {
    const result = forecastDemand({ ...base, series: series(Array(10).fill(4)) })
    expect(result.assumptions.length).toBeGreaterThan(0)
  })
})
