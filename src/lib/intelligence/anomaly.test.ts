import { describe, it, expect } from 'vitest'
import { detectAnomalies, type AnomalyInput } from './anomaly'

function base(overrides: Partial<AnomalyInput> = {}): AnomalyInput {
  return {
    series: [],
    totalOrders: 0,
    deliveredOrders: 0,
    pendingOrders: 0,
    ordersWithoutPaymentState: 0,
    averageShippingFee: null,
    configuredShippingFee: null,
    topProductShare: null,
    dataCompleteness: 1,
    agedOrders: 0,
    agedValue: 0,
    ...overrides,
  }
}

describe('detectAnomalies', () => {
  it('says nothing when the data is healthy', () => {
    const anomalies = detectAnomalies(
      base({
        totalOrders: 100,
        deliveredOrders: 80,
        ordersWithoutPaymentState: 10,
        averageShippingFee: 30,
        configuredShippingFee: 30,
        dataCompleteness: 0.95,
      })
    )
    expect(anomalies).toHaveLength(0)
  })

  it('raises a critical anomaly when nothing is delivered', () => {
    const anomalies = detectAnomalies(base({ totalOrders: 741, deliveredOrders: 0 }))
    const first = anomalies.find(a => a.id === 'no_deliveries')!
    expect(first).toBeDefined()
    expect(first.severity).toBe('critical')
    expect(first.affected).toBe(741)
    expect(first.recommendedAction.length).toBeGreaterThan(10)
  })

  it('flags the shipping fee mismatch with both numbers', () => {
    const anomalies = detectAnomalies(
      base({ totalOrders: 100, deliveredOrders: 50, averageShippingFee: 59.85, configuredShippingFee: 30 })
    )
    const a = anomalies.find(x => x.id === 'shipping_fee_mismatch')!
    expect(a).toBeDefined()
    expect(a.baseline).toContain('30')
    expect(a.actual).toContain('59')
  })

  it('does not flag a shipping fee within the tolerance', () => {
    const anomalies = detectAnomalies(
      base({ totalOrders: 100, deliveredOrders: 50, averageShippingFee: 32, configuredShippingFee: 30 })
    )
    expect(anomalies.find(x => x.id === 'shipping_fee_mismatch')).toBeUndefined()
  })

  it('stays silent on a short series (no false alarms on small samples)', () => {
    const anomalies = detectAnomalies(
      base({
        series: [
          { date: '2026-11-01', orders: 1, revenue: 100 },
          { date: '2026-11-02', orders: 30, revenue: 3000 },
        ],
        totalOrders: 31,
        deliveredOrders: 20,
      })
    )
    expect(anomalies.filter(a => a.id.startsWith('day_outlier'))).toHaveLength(0)
  })

  it('flags an outlier day on a long enough series', () => {
    const series = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-11-${String(i + 1).padStart(2, '0')}`,
      orders: 10,
      revenue: 1000,
    }))
    series.push({ date: '2026-11-11', orders: 90, revenue: 90000 })
    const anomalies = detectAnomalies(
      base({ series, totalOrders: 190, deliveredOrders: 100 })
    )
    expect(anomalies.some(a => a.id === 'day_outlier_2026-11-11')).toBe(true)
  })

  it('flags the growing backlog when the second half is much busier', () => {
    const series = [
      ...Array.from({ length: 5 }, (_, i) => ({ date: `2026-11-0${i + 1}`, orders: 5, revenue: 500 })),
      ...Array.from({ length: 5 }, (_, i) => ({ date: `2026-11-1${i}`, orders: 30, revenue: 3000 })),
    ]
    const anomalies = detectAnomalies(base({ series, totalOrders: 175, deliveredOrders: 10 }))
    expect(anomalies.some(a => a.id === 'backlog_growth')).toBe(true)
  })

  it('flags the concentration on a single product', () => {
    const anomalies = detectAnomalies(
      base({ totalOrders: 100, deliveredOrders: 90, topProductShare: 0.78 })
    )
    expect(anomalies.find(a => a.id === 'product_concentration')!.actual).toContain('78%')
  })

  it('flags low data completeness with the setup link', () => {
    const anomalies = detectAnomalies(
      base({ totalOrders: 100, deliveredOrders: 90, dataCompleteness: 0.3 })
    )
    const a = anomalies.find(x => x.id === 'low_data_completeness')!
    expect(a.href).toBe('/setup/costs')
  })

  it('flags aged orders that never moved', () => {
    const anomalies = detectAnomalies(
      base({ totalOrders: 100, deliveredOrders: 50, agedOrders: 25, agedValue: 90000 })
    )
    expect(anomalies.find(a => a.id === 'aged_orders')!.affected).toBe(25)
  })
})
