/**
 * Metric types — every number the business OS shows carries its own
 * provenance.
 *
 * WHY THIS EXISTS
 *
 * The dashboard used to print a single `provisional_profit` number that was
 * really "sales − (COGS that is 0 for every product) − expenses". With all
 * twelve products carrying `cost_price = 0` and no advertising integration,
 * that number was arithmetically correct and economically meaningless.
 *
 * Analify's rule — and the rule this module implements — is **"Math before
 * AI" with honest withholding**: a metric is only published when the data
 * behind it exists. Otherwise the metric is published with a STATUS that says
 * why it is not a fact, and the UI must show that state instead of a number.
 *
 * The five states:
 *   actual      — computed from complete real records.
 *   estimated   — computed, but from a documented approximation.
 *   incomplete  — the value exists but the data behind it is partial.
 *   unavailable — cannot be computed at all with the current connections.
 *   (plus `not_applicable` for windows where the metric has no meaning.)
 */

/** The honest state of a metric. */
export type MetricStatus =
  | 'actual'
  | 'estimated'
  | 'incomplete'
  | 'unavailable'
  | 'not_applicable'

export type MetricUnit = 'currency' | 'count' | 'percent' | 'ratio' | 'days'

/** How the number was produced, in words a store owner can check. */
export interface MetricProvenance {
  status: MetricStatus
  /** The formula, in plain Arabic, e.g. "المبيعات − تكلفة المنتجات − المصروفات". */
  calculation: string
  /** The tables / sources the numbers were read from. */
  source: string[]
  /** What is missing or approximated — the reason for a non-`actual` status. */
  missing: string[]
  /** 0..1 — how much of the underlying data was present. */
  completeness: number
  /** When the underlying records were last changed (ISO), when known. */
  dataUpdatedAt?: string | null
}

/** A single published metric. `value` is null when the status is not `actual`. */
export interface Metric {
  key: string
  label: string
  value: number | null
  unit: MetricUnit
  provenance: MetricProvenance
  /** Comparison with the previous, equal-length period (null when unknown). */
  previous?: number | null
  /** Percentage change vs. the previous period (null when not computable). */
  changePercent?: number | null
  /** Short Arabic explanation shown under the card. */
  note?: string
}

/** A named, machine-checkable data gap. */
export interface DataGap {
  id: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  detail: string
  /** Which module fixes it. */
  area: 'brain' | 'integrations' | 'finance' | 'operations' | 'data'
  /** Link the UI can offer. */
  actionHref?: string
}

/** An operational alert that is derived from real records. */
export interface BusinessAlert {
  id: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  detail: string
  metricKey?: string
  createdAt: string
}

/** A health indicator (0..100) with the reason for the score. */
export interface HealthIndicator {
  key: string
  label: string
  score: number
  status: 'good' | 'attention' | 'critical' | 'unknown'
  detail: string
}

/** The resolved window every metric in a response refers to. */
export interface MetricWindow {
  preset: string
  label: string
  /** ISO instants; null = open bound. */
  from: string | null
  to: string | null
  /** The previous, equal-length window used for comparisons. */
  previousFrom: string | null
  previousTo: string | null
  timezone: string
  /** When this response was computed. */
  computedAt: string
}

/** The full payload of the executive overview endpoint. */
export interface BusinessOverview {
  window: MetricWindow
  metrics: Metric[]
  /** Lookup by key, same objects. */
  byKey: Record<string, Metric>
  alerts: BusinessAlert[]
  health: HealthIndicator[]
  gaps: DataGap[]
  /** Top products by revenue in the window. */
  topProducts: ProductPerformance[]
  /** EVERY product that sold in the window (the analytics module needs all of them). */
  products: ProductPerformance[]
  /** Products whose margin is negative or whose cost data is missing. */
  losingProducts: ProductPerformance[]
  /** Daily series for the revenue/profit chart. */
  series: DailyPoint[]
}

export interface ProductPerformance {
  productId: string
  name: string
  sku: string | null
  units: number
  revenue: number
  cost: number
  /** null when the cost is unknown — the UI must not draw a margin then. */
  margin: number | null
  marginPercent: number | null
  status: MetricStatus
}

export interface DailyPoint {
  /** Cairo business day, `YYYY-MM-DD`. */
  date: string
  orders: number
  revenue: number
  cost: number
  expenses: number
  /** null when the cost data is incomplete for that day. */
  profit: number | null
}

/** A finance document (income/expense) used by the finance module. */
export interface FinanceEntry {
  id: string
  date: string
  kind: 'income' | 'expense'
  category: string
  amount: number
  source: 'manual' | 'courier' | 'store' | 'import'
  note?: string | null
  voided: boolean
}
