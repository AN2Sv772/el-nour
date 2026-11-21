import { describe, it, expect } from 'vitest'
import { computeCostCoverage, isCostKnown, coveredRevenuePercent } from './cost-coverage'

describe('isCostKnown', () => {
  it('treats zero, null and undefined as an unknown cost', () => {
    expect(isCostKnown(null)).toBe(false)
    expect(isCostKnown(undefined)).toBe(false)
    expect(isCostKnown(0)).toBe(false)
    expect(isCostKnown(Number.NaN)).toBe(false)
  })

  it('accepts any positive cost', () => {
    expect(isCostKnown(0.01)).toBe(true)
    expect(isCostKnown(120)).toBe(true)
  })
})

describe('computeCostCoverage', () => {
  it('reports nothing missing when every product has a cost', () => {
    const coverage = computeCostCoverage([
      { id: '1', name: 'A', price: 200, costPrice: 120, units: 10, revenue: 2000 },
      { id: '2', name: 'B', price: 100, costPrice: 60, units: 5, revenue: 500 },
    ])
    expect(coverage.missingCost).toBe(0)
    expect(coverage.profitComputable).toBe(true)
    expect(coverage.blindRevenue).toBe(0)
    expect(coverage.weightedRatio).toBe(1)
  })

  it('keeps the margin hidden while a cost is missing', () => {
    const coverage = computeCostCoverage([
      { id: '1', name: 'A', price: 200, costPrice: 120, units: 10, revenue: 2000 },
      { id: '2', name: 'B', price: 100, costPrice: null, units: 5, revenue: 500 },
    ])
    const b = coverage.rows.find((r) => r.id === '2')!
    expect(b.hasCost).toBe(false)
    expect(b.margin).toBeNull()
    expect(b.marginPercent).toBeNull()
    expect(coverage.profitComputable).toBe(false)
  })

  it('sorts the rows by revenue impact so the biggest blocker comes first', () => {
    const coverage = computeCostCoverage([
      { id: 'small', name: 'S', price: 100, costPrice: null, units: 1, revenue: 100 },
      { id: 'big', name: 'B', price: 100, costPrice: null, units: 20, revenue: 2000 },
      { id: 'done', name: 'D', price: 100, costPrice: 50, units: 3, revenue: 300 },
    ])
    expect(coverage.rows.map((r) => r.id)).toEqual(['big', 'small', 'done'])
    expect(coverage.blindRevenue).toBe(2100)
    expect(coverage.coveredRevenue).toBe(300)
  })

  it('computes the margin and its percentage for a known cost', () => {
    const coverage = computeCostCoverage([
      { id: '1', name: 'A', price: 200, costPrice: 150, units: 4, revenue: 800 },
    ])
    const row = coverage.rows[0]
    expect(row.margin).toBe(50)
    expect(row.marginPercent).toBeCloseTo(0.25)
    expect(row.revenueAtRisk).toBe(0)
  })

  it('explains the blocker in Arabic instead of guessing a number', () => {
    const coverage = computeCostCoverage([
      { id: '1', name: 'A', price: 200, costPrice: null, units: 4, revenue: 800 },
    ])
    expect(coverage.blockers.join(' ')).toContain('بلا تكلفة')
    expect(coverage.blockers.join(' ')).toContain('محجوب')
  })

  it('handles an empty catalogue without dividing by zero', () => {
    const coverage = computeCostCoverage([])
    expect(coverage.totalProducts).toBe(0)
    expect(coverage.ratio).toBe(1)
    expect(coverage.weightedRatio).toBe(1)
    expect(coverage.profitComputable).toBe(false)
  })
})

describe('coveredRevenuePercent', () => {
  it('formats the share of the revenue', () => {
    expect(coveredRevenuePercent(300, 2400)).toBe('12.5%')
    expect(coveredRevenuePercent(0, 0)).toBe('0%')
  })
})
