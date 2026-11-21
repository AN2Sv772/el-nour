/**
 * Demand forecasting — honest baselines, measured error.
 *
 * WHY NOT A MODEL
 * ---------------
 * A neural forecast on 30 days of a single Egyptian store would be a costume,
 * not a capability. What actually helps an owner is:
 *   1. a baseline that beats "assume the same as yesterday",
 *   2. the measured error of that baseline (MAPE) so the owner knows how much
 *      to trust it,
 *   3. an honest "not enough data" when there is not enough data.
 *
 * So the engine backtests three simple methods (naive, moving average,
 * linear trend) on a chronological holdout, picks the one with the lowest
 * error, and publishes the error with the forecast. It is explicitly NOT
 * machine learning, and it says so.
 */

export interface ForecastPoint {
  date: string
  /** Expected orders. */
  orders: number
  /** Expected revenue (EGP). */
  revenue: number
  /** 80% interval — the spread the method historically showed. */
  lower: number
  upper: number
}

export type ForecastMethod = 'naive' | 'moving_average' | 'linear_trend' | 'insufficient_data'

export interface ForecastResult {
  method: ForecastMethod
  methodLabel: string
  /** 1..90 days. */
  horizonDays: number
  points: ForecastPoint[]
  /** Mean absolute percentage error of the chosen method on the holdout. */
  backtestMape: number | null
  /** How many days were used for the backtest. */
  backtestDays: number
  /** Confidence in the forecast, derived from the measured error. */
  confidence: 'low' | 'medium' | 'high'
  /** What would have to be true for this forecast to hold. */
  assumptions: string[]
  /** What is missing / limits the forecast. */
  limitations: string[]
  /** For product-level forecasts. */
  products?: ProductForecast[]
}

export interface ProductForecast {
  productId: string
  name: string
  /** Units per day, expected. */
  unitsPerDay: number
  /** Expected units over the horizon. */
  expectedUnits: number
  /** null when the store does not track stock — the date cannot exist. */
  depletionDate: string | null
  /** null when the stock is not tracked. */
  reorderDate: string | null
  note: string
}

export interface ForecastInput {
  /** Chronological daily series (oldest first). */
  series: { date: string; orders: number; revenue: number }[]
  horizonDays: number
  /** Average order value, used to turn orders into revenue. */
  averageOrderValue: number
  /** Does the store track inventory? */
  inventoryTracked: boolean
  /** Stock per product (only meaningful when tracked). */
  stock?: { productId: string; name: string; stock: number }[]
  /** Units sold per product per day. */
  productUnits?: { productId: string; name: string; units: number; days: number }[]
}

const MIN_DAYS = 7
const MIN_HOLDOUT = 3

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/* ── The three candidate methods ─────────────────────────────────── */

function naivePredict(history: number[]): number {
  return history[history.length - 1]
}

function movingAveragePredict(history: number[], window = 7): number {
  const slice = history.slice(-window)
  return slice.reduce((s, v) => s + v, 0) / Math.max(1, slice.length)
}

function linearTrendPredict(history: number[]): number {
  const n = history.length
  if (n < 2) return history[0] ?? 0
  const meanX = (n - 1) / 2
  const meanY = history.reduce((s, v) => s + v, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (history[i] - meanY)
    den += (i - meanX) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  return meanY + slope * (n - meanX)
}

type Method = (history: number[]) => number

const METHODS: { key: ForecastMethod; label: string; fn: Method }[] = [
  { key: 'naive', label: 'آخر قيمة (naive)', fn: naivePredict },
  { key: 'moving_average', label: 'متوسط متحرك 7 أيام', fn: (h) => movingAveragePredict(h, 7) },
  { key: 'linear_trend', label: 'اتجاه خطي', fn: linearTrendPredict },
]

/** Backtest one method on a chronological holdout and return its MAPE. */
function backtest(
  series: { date: string; orders: number; revenue: number }[],
  fn: Method
): { mape: number; holdoutDays: number } {
  const values = series.map(d => d.orders)
  const total = values.length
  const holdout = Math.min(MIN_HOLDOUT, Math.max(0, Math.floor(total / 3)))
  if (holdout === 0 || total - holdout < 2) return { mape: Number.POSITIVE_INFINITY, holdoutDays: 0 }

  let errors = 0
  let counted = 0
  for (let i = 0; i < holdout; i++) {
    const history = values.slice(0, total - holdout + i)
    const actual = values[total - holdout + i]
    const predicted = fn(history)
    if (actual === 0) {
      // A zero day tells us nothing about a percentage error.
      errors += Math.abs(predicted - actual)
      counted += 1
      continue
    }
    errors += Math.abs(predicted - actual) / actual
    counted += 1
  }
  if (counted === 0) return { mape: Number.POSITIVE_INFINITY, holdoutDays: holdout }
  return { mape: (errors / counted) * 100, holdoutDays: holdout }
}

/** Build the forecast for a daily series. */
export function forecastDemand(input: ForecastInput): ForecastResult {
  const series = input.series
  const assumptions: string[] = []
  const limitations: string[] = []

  if (series.length < MIN_DAYS) {
    limitations.push(
      `توجد ${series.length} أيام فقط من البيانات — الحد الأدنى ${MIN_DAYS} أيام لبناء أي تنبؤ`
    )
    return {
      method: 'insufficient_data',
      methodLabel: 'بيانات غير كافية',
      horizonDays: input.horizonDays,
      points: [],
      backtestMape: null,
      backtestDays: 0,
      confidence: 'low',
      assumptions,
      limitations,
    }
  }

  // Pick the method with the lowest measured error.
  const scored = METHODS.map(m => ({ ...m, ...backtest(series, m.fn) }))
  scored.sort((a, b) => a.mape - b.mape)
  const best = scored[0]
  const usable = Number.isFinite(best.mape)

  const values = series.map(d => d.orders)
  const lastDate = new Date(`${series[series.length - 1].date}T00:00:00.000Z`)

  const points: ForecastPoint[] = []
  for (let i = 1; i <= input.horizonDays; i++) {
    const predicted = Math.max(0, best.fn(values))
    const date = new Date(lastDate.getTime() + i * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    // The interval is the measured error, not a decorative band.
    const spread = usable ? predicted * (best.mape / 100) : predicted * 0.5
    points.push({
      date,
      orders: round(predicted),
      revenue: round(predicted * input.averageOrderValue),
      lower: round(Math.max(0, predicted - spread)),
      upper: round(predicted + spread),
    })
  }

  const mape = usable ? round(best.mape) : null
  const confidence: ForecastResult['confidence'] =
    !usable || mape === null
      ? 'low'
      : mape <= 20
        ? 'high'
        : mape <= 50
          ? 'medium'
          : 'low'

  assumptions.push(
    'الأيام القادمة تحاكي نفس النمط الذي ظهر في الفترة السابقة',
    'لا توجد حملة إعلانية أو عرض ترويجي جديد لم يُسجَّل',
    'متوسط قيمة الطلب يبقى كما هو',
  )
  limitations.push(
    `الخطأ المقاس على ${best.holdoutDays} أيام محفوظة: ${mape ?? 'غير معروف'}% (MAPE)`,
    'التنبؤ لا يعرف أي حملة إعلانية قادمة',
  )
  if (input.inventoryTracked === false) {
    limitations.push('المخزون غير مُدار في النظام — لا يمكن حساب تاريخ نفاد المخزون')
  }

  /* Product level — units per day, and the stock dates only when tracked. */
  let products: ProductForecast[] | undefined
  if (input.productUnits && input.productUnits.length > 0) {
    const stockById = new Map((input.stock ?? []).map(s => [s.productId, s]))
    products = input.productUnits.map(p => {
      const unitsPerDay = p.days > 0 ? round(p.units / p.days) : 0
      const expectedUnits = round(unitsPerDay * input.horizonDays)
      let depletionDate: string | null = null
      let reorderDate: string | null = null
      const stock = stockById.get(p.productId)
      if (input.inventoryTracked && stock && stock.stock > 0 && unitsPerDay > 0) {
        const daysLeft = Math.floor(stock.stock / unitsPerDay)
        const depletion = new Date(lastDate.getTime() + daysLeft * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        depletionDate = depletion
        const lead = 7
        const reorder = new Date(lastDate.getTime() + Math.max(0, daysLeft - lead) * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        reorderDate = reorder
      }
      return {
        productId: p.productId,
        name: p.name,
        unitsPerDay,
        expectedUnits,
        depletionDate,
        reorderDate,
        note: input.inventoryTracked
          ? 'التقدير مبني على متوسط الوحدات اليومية في الفترة'
          : 'المخزون غير مُدار — الكمية المتوقعة فقط، بلا تاريخ نفاد',
      }
    })
  }

  return {
    method: best.key,
    methodLabel: best.label,
    horizonDays: input.horizonDays,
    points,
    backtestMape: mape,
    backtestDays: best.holdoutDays,
    confidence,
    assumptions,
    limitations,
    products,
  }
}
