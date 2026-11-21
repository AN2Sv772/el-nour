/**
 * Cost coverage — the bridge between "the dashboard shows no profit" and
 * "the owner typed the real costs".
 *
 * The rule of the product: profit is *withheld*, not *missing*. So the UI has
 * to be able to say exactly what is missing and what becomes computable the
 * moment the missing piece is entered. This module is pure on purpose: the
 * same arithmetic decides the banner, the progress bar and the tests.
 */

export interface CostProduct {
  id: string
  name: string
  price: number
  /** null/undefined/0 ⇒ the cost is unknown and margin MUST stay hidden. */
  costPrice: number | null
  /** Units sold in the inspected window — used to order the work by impact. */
  units?: number
  revenue?: number
}

export interface CostCoverageRow extends CostProduct {
  /** Normalised: 0 when the product never sold in the inspected window. */
  units: number
  revenue: number
  hasCost: boolean
  /** margin = price − cost; null while the cost is unknown. */
  margin: number | null
  marginPercent: number | null
  /** What the owner loses by not fixing this row right now (in EGP). */
  revenueAtRisk: number
  /** Highest revenue first — the rows that unblock the most money. */
  impact: number
}

export interface CostCoverage {
  rows: CostCoverageRow[]
  totalProducts: number
  withCost: number
  missingCost: number
  /** 0..1 — share of products that have a real cost. */
  ratio: number
  /** Revenue of the rows that still have no cost (EGP). */
  blindRevenue: number
  totalRevenue: number
  /** Revenue covered by products whose cost is known (EGP). */
  coveredRevenue: number
  /** Revenue-weighted coverage — better than the product-count ratio. */
  weightedRatio: number
  /** True when every product that sold has a cost ⇒ profit becomes computable. */
  profitComputable: boolean
  /** What exactly is still missing, in plain Arabic. */
  blockers: string[]
}

const EPS = 1e-9

export function isCostKnown(costPrice: number | null | undefined): boolean {
  return typeof costPrice === 'number' && Number.isFinite(costPrice) && costPrice > EPS
}

export function computeCostCoverage(products: CostProduct[]): CostCoverage {
  const rows: CostCoverageRow[] = products.map((p) => {
    const hasCost = isCostKnown(p.costPrice)
    const revenue = p.revenue ?? 0
    const margin = hasCost ? p.price - (p.costPrice as number) : null
    const marginPercent = hasCost && p.price > EPS ? (margin as number) / p.price : null
    return {
      ...p,
      units: p.units ?? 0,
      revenue,
      hasCost,
      margin,
      marginPercent,
      revenueAtRisk: hasCost ? 0 : revenue,
      impact: hasCost ? 0 : revenue,
    }
  })

  // Highest impact first: the products that sold the most and still have no
  // cost are the ones that block the profit statement the longest.
  rows.sort((a, b) => b.impact - a.impact || (a.units ?? 0) - (b.units ?? 0))

  const totalProducts = rows.length
  const withCost = rows.filter((r) => r.hasCost).length
  const totalRevenue = rows.reduce((sum, r) => sum + (r.revenue ?? 0), 0)
  const blindRevenue = rows.reduce((sum, r) => sum + r.revenueAtRisk, 0)
  const coveredRevenue = Math.max(0, totalRevenue - blindRevenue)
  const weightedRatio =
    totalRevenue > EPS
      ? coveredRevenue / totalRevenue
      : totalProducts === 0
        ? 1
        : withCost / totalProducts

  const blockers: string[] = []
  const missing = totalProducts - withCost
  if (missing > 0) {
    blockers.push(
      `${missing} منتج بلا تكلفة شراء — صافي الربح محجوب عن ${coveredRevenuePercent(coveredRevenue, totalRevenue)} من المبيعات`,
    )
  }
  if (totalRevenue > EPS && blindRevenue > EPS) {
    blockers.push('تكلفة المنتجات الناقصة هي سبب حجب مجمل الربح')
  }

  return {
    rows,
    totalProducts,
    withCost,
    missingCost: missing,
    ratio: totalProducts > 0 ? withCost / totalProducts : 1,
    blindRevenue,
    totalRevenue,
    coveredRevenue,
    weightedRatio,
    profitComputable: missing === 0 && totalProducts > 0,
    blockers,
  }
}

/** Share of the revenue whose margin can already be computed. */
export function coveredRevenuePercent(covered: number, total: number): string {
  if (total <= EPS) return '0%'
  const pct = Math.round((covered / total) * 1000) / 10
  return `${pct}%`
}
