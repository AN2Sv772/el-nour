/**
 * Profit simulator — non-destructive what-if.
 *
 * The owner asks "what if I raise the price by 10%?" and gets a number with
 * its assumptions. Two rules make this trustworthy:
 *
 *   1. It NEVER writes anything. The whole module is pure arithmetic over a
 *      snapshot of the current period.
 *   2. It NEVER publishes a net profit when the inputs for one are missing.
 *      If the product costs are unknown, the simulator shows the revenue and
 *      the cash effects, and says the profit is still withheld — the same
 *      rule the rest of the app follows.
 */

export type SimulatorLever =
  | 'price'
  | 'product_cost'
  | 'shipping_cost'
  | 'return_rate'
  | 'ad_spend'
  | 'conversion'
  | 'average_order_value'
  | 'delivery_rate'
  | 'product_mix'

export interface SimulatorSnapshot {
  orders: number
  revenue: number
  averageOrderValue: number
  productCost: number | null
  shippingCost: number | null
  operatingExpenses: number | null
  adSpend: number | null
  /** 0..1 — share of orders that come back (RTO). */
  returnRate: number | null
  /** 0..1 — share of orders that are delivered. */
  deliveryRate: number | null
  /** True when the store records no expenses at all. */
  expensesNotRecorded: boolean
}

export interface SimulatorScenario {
  lever: SimulatorLever
  /** The change the owner asked for (e.g. +0.1 for +10%). */
  change: number
}

export interface SimulatorResult {
  /** The current state, for a before/after comparison. */
  baseline: {
    orders: number
    revenue: number
    /** null while the inputs are missing. */
    netProfit: number | null
    marginPercent: number | null
  }
  scenario: {
    orders: number
    revenue: number
    productCost: number | null
    shippingCost: number | null
    operatingExpenses: number | null
    adSpend: number | null
    netProfit: number | null
    marginPercent: number | null
    /** The change in profit, or null when the profit is withheld. */
    profitDelta: number | null
    revenueDelta: number
    /** Break-even: how many orders cover the fixed costs. */
    breakEvenOrders: number | null
    /** Contribution per order. */
    contributionPerOrder: number | null
    /** The most the store can pay for a customer and still break even. */
    maxAcceptableAcquisitionCost: number | null
  }
  /** What the simulation assumes. */
  assumptions: string[]
  /** What it cannot know. */
  limitations: string[]
  /** True when the numbers are not a promise. */
  isProjection: true
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Run one scenario.
 *
 * The levers are applied in this order: price → mix → conversion → delivery
 * → returns → costs → ads. Each lever only touches what it can honestly
 * touch.
 */
export function simulate(snapshot: SimulatorSnapshot, scenarios: SimulatorScenario[]): SimulatorResult {
  const assumptions: string[] = []
  const limitations: string[] = []

  let orders = snapshot.orders
  let priceFactor = 1
  let conversionFactor = 1
  let mixFactor = 1
  let deliveryFactor = 1
  let returnFactor = 1
  let costFactor = 1
  let shippingFactor = 1
  let adFactor = 1

  for (const scenario of scenarios) {
    switch (scenario.lever) {
      case 'price':
        priceFactor *= 1 + scenario.change
        assumptions.push(`سعر البيع ${scenario.change >= 0 ? 'يزيد' : 'ينخفض'} ${Math.abs(round(scenario.change * 100))}%`)
        break
      case 'product_cost':
        costFactor *= 1 + scenario.change
        assumptions.push(`تكلفة المنتجات ${scenario.change >= 0 ? 'ترتفع' : 'تنخفض'} ${Math.abs(round(scenario.change * 100))}%`)
        break
      case 'shipping_cost':
        shippingFactor *= 1 + scenario.change
        assumptions.push(`تكلفة الشحن ${scenario.change >= 0 ? 'ترتفع' : 'تنخفض'} ${Math.abs(round(scenario.change * 100))}%`)
        break
      case 'return_rate':
        returnFactor *= 1 + scenario.change
        assumptions.push(`معدل المرتجعات ${scenario.change >= 0 ? 'يرتفع' : 'ينخفض'} ${Math.abs(round(scenario.change * 100))}%`)
        break
      case 'ad_spend':
        adFactor *= 1 + scenario.change
        assumptions.push(`الإنفاق الإعلاني ${scenario.change >= 0 ? 'يزيد' : 'ينخفض'} ${Math.abs(round(scenario.change * 100))}%`)
        break
      case 'conversion':
        conversionFactor *= 1 + scenario.change
        assumptions.push(`معدل التحويل ${scenario.change >= 0 ? 'يرتفع' : 'ينخفض'} ${Math.abs(round(scenario.change * 100))}%`)
        break
      case 'average_order_value':
        priceFactor *= 1 + scenario.change
        assumptions.push(`متوسط قيمة الطلب ${scenario.change >= 0 ? 'يزيد' : 'ينخفض'} ${Math.abs(round(scenario.change * 100))}%`)
        break
      case 'delivery_rate':
        deliveryFactor *= 1 + scenario.change
        assumptions.push(`معدل التسليم ${scenario.change >= 0 ? 'يرتفع' : 'ينخفض'} ${Math.abs(round(scenario.change * 100))}%`)
        break
      case 'product_mix':
        mixFactor *= 1 + scenario.change
        assumptions.push(`مزيج المنتجات ${scenario.change >= 0 ? 'يتحسن' : 'يتدهور'} ${Math.abs(round(scenario.change * 100))}%`)
        break
    }
  }

  // Orders respond to conversion and to the delivery rate (undelivered orders
  // are lost revenue in a COD store).
  orders = Math.max(0, round(orders * conversionFactor * deliveryFactor))

  const unitPrice = snapshot.averageOrderValue * priceFactor * mixFactor
  // The revenue is scaled from the ACTUAL revenue, not recomputed from the
  // average — otherwise a simulation with no levers would show a rounding
  // difference and look like it changed something.
  const orderFactor = snapshot.orders > 0 ? orders / snapshot.orders : 0
  const revenueScale = priceFactor * mixFactor * orderFactor
  let revenue = Math.max(0, round(snapshot.revenue * revenueScale))

  // Returns remove revenue AND the shipping cost that was already paid.
  const returnRate = snapshot.returnRate
  let effectiveRevenue = revenue
  if (returnRate !== null && returnFactor !== 1) {
    const newReturnRate = Math.max(0, Math.min(1, returnRate * returnFactor))
    effectiveRevenue = round(revenue * (1 - newReturnRate))
  }

  const productCost =
    snapshot.productCost === null ? null : round(snapshot.productCost * costFactor * (orders / Math.max(1, snapshot.orders)))
  const shippingCost =
    snapshot.shippingCost === null ? null : round(snapshot.shippingCost * shippingFactor * (orders / Math.max(1, snapshot.orders)))
  const operatingExpenses =
    snapshot.operatingExpenses === null ? null : round(snapshot.operatingExpenses)
  const adSpend = snapshot.adSpend === null ? null : round(snapshot.adSpend * adFactor)

  const profitInputsMissing: string[] = []
  if (productCost === null) profitInputsMissing.push('تكلفة المنتجات غير مسجّلة')
  if (shippingCost === null) profitInputsMissing.push('تكلفة الشحن غير متاحة')
  if (operatingExpenses === null) profitInputsMissing.push('المصروفات التشغيلية غير مسجّلة')
  if (adSpend === null) profitInputsMissing.push('مصروف الإعلانات غير متاح')

  const netProfit =
    profitInputsMissing.length === 0
      ? round(
          effectiveRevenue -
            (productCost as number) -
            (shippingCost as number) -
            (operatingExpenses as number) -
            (adSpend as number),
        )
      : null

  const baselineProfitMissing: string[] = []
  if (snapshot.productCost === null) baselineProfitMissing.push('تكلفة المنتجات')
  if (snapshot.shippingCost === null) baselineProfitMissing.push('تكلفة الشحن')
  if (snapshot.operatingExpenses === null) baselineProfitMissing.push('المصروفات')
  if (snapshot.adSpend === null) baselineProfitMissing.push('الإعلانات')
  const baselineProfit =
    baselineProfitMissing.length === 0
      ? round(
          snapshot.revenue -
            (snapshot.productCost as number) -
            (snapshot.shippingCost as number) -
            (snapshot.operatingExpenses as number) -
            (snapshot.adSpend as number),
        )
      : null

  // Contribution per order and break-even.
  const contribution =
    productCost !== null && shippingCost !== null
      ? round(unitPrice - (productCost as number) / Math.max(1, snapshot.orders) - (shippingCost as number) / Math.max(1, snapshot.orders))
      : null
  const fixedCosts =
    operatingExpenses !== null && adSpend !== null
      ? (operatingExpenses as number) + (adSpend as number)
      : null
  const breakEvenOrders =
    contribution !== null && fixedCosts !== null && contribution > 0
      ? Math.ceil(fixedCosts / contribution)
      : null
  const maxCac =
    contribution !== null ? round(Math.max(0, contribution)) : null

  if (netProfit === null) {
    limitations.push(
      `صافي الربح ما زال محجوبًا: ${profitInputsMissing.join(' · ')} — المحاكاة تُظهر أثر المبيعات والتكلفة فقط`,
    )
  }
  limitations.push('المحاكاة تفترض ثبات حجم الطلبات ما لم تُغيّر معدل التحويل أو التسليم')
  if (snapshot.returnRate === null) {
    limitations.push('معدل المرتجعات غير معروف — لم يُطبَّق أثر المرتجعات على المبيعات')
  }
  if (snapshot.expensesNotRecorded) {
    limitations.push('لا تُسجَّل مصروفات في النظام — الرقم المحاكى سيكون متحفظًا إن لم تُسجَّل')
  }
  assumptions.push('الأسعار والتكاليف ثابتة خلال الفترة المحاكاة')

  const margin = (value: number | null) =>
    value !== null && effectiveRevenue > 0 ? round((value / effectiveRevenue) * 100) : null

  return {
    baseline: {
      orders: snapshot.orders,
      revenue: snapshot.revenue,
      netProfit: baselineProfit,
      marginPercent: baselineProfit !== null && snapshot.revenue > 0 ? round((baselineProfit / snapshot.revenue) * 100) : null,
    },
    scenario: {
      orders,
      revenue: effectiveRevenue,
      productCost,
      shippingCost,
      operatingExpenses,
      adSpend,
      netProfit,
      marginPercent: margin(netProfit),
      profitDelta:
        netProfit !== null && baselineProfit !== null ? round(netProfit - baselineProfit) : null,
      revenueDelta: round(effectiveRevenue - snapshot.revenue),
      breakEvenOrders,
      contributionPerOrder: contribution,
      maxAcceptableAcquisitionCost: maxCac,
    },
    assumptions,
    limitations,
    isProjection: true,
  }
}

/** The levers the UI offers, with their Arabic labels and ranges. */
export const SIMULATOR_LEVERS: {
  lever: SimulatorLever
  label: string
  hint: string
  min: number
  max: number
  step: number
}[] = [
  { lever: 'price', label: 'سعر البيع', hint: 'تغيير سعر كل المنتجات', min: -0.5, max: 0.5, step: 0.01 },
  { lever: 'product_cost', label: 'تكلفة المنتجات', hint: 'تغيير تكلفة الشراء', min: -0.5, max: 0.5, step: 0.01 },
  { lever: 'shipping_cost', label: 'تكلفة الشحن', hint: 'تكلفة الشحن لكل طلب', min: -0.5, max: 0.5, step: 0.01 },
  { lever: 'return_rate', label: 'معدل المرتجعات', hint: 'نسبة الطلبات التي ترجع', min: -0.5, max: 0.5, step: 0.01 },
  { lever: 'ad_spend', label: 'الإنفاق الإعلاني', hint: 'ميزانية الإعلانات', min: -1, max: 1, step: 0.05 },
  { lever: 'conversion', label: 'معدل التحويل', hint: 'نسبة تحويل الزائر إلى طلب', min: -0.5, max: 0.5, step: 0.01 },
  { lever: 'average_order_value', label: 'متوسط قيمة الطلب', hint: 'سلة أكبر أو أصغر', min: -0.5, max: 0.5, step: 0.01 },
  { lever: 'delivery_rate', label: 'معدل التسليم', hint: 'نسبة الطلبات التي تصل', min: -0.5, max: 0.5, step: 0.01 },
  { lever: 'product_mix', label: 'مزيج المنتجات', hint: 'البيع نحو المنتجات الأعلى هامشًا', min: -0.5, max: 0.5, step: 0.01 },
]
