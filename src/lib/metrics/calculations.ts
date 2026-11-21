/**
 * Pure calculation layer for the business metrics.
 *
 * WHY A SEPARATE PURE LAYER
 *
 * Every number the business OS shows must be reproducible from rows and must
 * carry its own status. Keeping the arithmetic here — with no database access
 * — makes it unit-testable and makes it impossible for a route to quietly
 * invent a value.
 *
 * THE HONESTY RULE (the heart of this module)
 *
 * A metric is published as a NUMBER only when the data behind it exists.
 * Otherwise it is published with a STATUS that says why it is not a fact:
 *
 *   actual      — computed from complete real records.
 *   estimated   — computed, but from a documented approximation.
 *   incomplete  — the value exists but the data behind it is partial.
 *   unavailable — cannot be computed at all with the current connections.
 *
 * The live project proves why: every one of the twelve products carries
 * `cost_price = 0`, and no advertising platform is connected. A "profit"
 * computed from that is arithmetically correct and economically meaningless.
 * Here it comes back as `incomplete` with the exact list of what is missing,
 * and `value` is null.
 *
 * The calculation model (documented, and the same one the owner's existing
 * accounting uses — see `src/lib/finance.ts`):
 *
 *   Recognised sales   = Σ total_amount of counted orders (not cancelled)
 *   Delivered sales    = Σ total_amount of orders with status = delivered
 *   Product costs      = Σ qty × unit_cost snapshot (fallback: product cost)
 *   Shipping collected = Σ shipping_fee of counted orders
 *   Shipping cost      = actual courier deductions, else the configured
 *                        fixed shipping fee per order
 *   Advertising        = Σ advertising spend (no source today → unavailable)
 *   Operating expenses = Σ expenses (voided rows excluded)
 *   Returned loss      = estimated: returned count × average order value
 *   Net profit         = Recognised sales − product costs − shipping cost
 *                        − advertising − operating expenses − returned loss
 */

import type {
  BusinessAlert,
  DailyPoint,
  DataGap,
  HealthIndicator,
  Metric,
  ProductPerformance,
} from './types'
import { round2 } from '@/lib/finance'
import { arabicCount } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* Input rows (the shapes the engine reads)                            */
/* ------------------------------------------------------------------ */

export interface MetricOrder {
  id: string
  total_amount: number | null
  shipping_fee: number | null
  status: string
  payment_status: string | null
  created_at: string
}

export interface MetricOrderItem {
  order_id: string
  product_id: string | null
  quantity: number | null
  unit_cost: number | null
}

export interface MetricProduct {
  id: string
  name: string
  sku: string | null
  price: number | null
  cost_price: number | null
  stock_quantity: number | null
  /** false = the store does not manage stock levels (all 12 products are like this today). */
  track_inventory: boolean | null
}

export interface MetricExpense {
  amount: number | null
  expense_date: string | null
  category: string | null
  voided_at: string | null
}

export interface MetricCollectionBatch {
  id?: string
  created_at?: string | null
  expected_amount: number | null
  received_amount: number | null
  status: string | null
}

export interface MetricCollectionDeduction {
  batch_id: string | null
  amount: number | null
  /** The real column is `label` — a free-text description of the charge. */
  label: string | null
}

export interface MetricReconciliation {
  /** The real column is `business_date` (a DATE, one row per business day). */
  business_date: string | null
  returned_orders_count: number | null
}

export interface AdvertisingSpend {
  /** null when no advertising platform is connected. */
  spend: number | null
  source: string
}

export interface MetricInputs {
  orders: MetricOrder[]
  items: MetricOrderItem[]
  products: MetricProduct[]
  expenses: MetricExpense[]
  collections: MetricCollectionBatch[]
  collectionDeductions: MetricCollectionDeduction[]
  reconciliations: MetricReconciliation[]
  /** Ad spend for the window; null when no platform is connected. */
  advertising: AdvertisingSpend | null
  /** The fixed shipping fee per order configured by the owner. */
  fixedShippingFee: number | null
  /** The business timezone, used for the daily series. */
  businessDate: (iso: string) => string
  /**
   * True when the `expenses` table holds NO rows at all — the store records
   * no expenses whatsoever. Zero then means "not recorded", not "no spend".
   */
  expensesTableIsEmpty?: boolean
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Orders that count as sales (the owner's rule: not cancelled, not returned). */
export function isCountedOrder(order: MetricOrder): boolean {
  return !['cancelled', 'returned'].includes(order.status)
}

function sum(values: (number | null | undefined)[]): number {
  return round2(values.reduce<number>((total, value) => total + (value || 0), 0))
}

/** A metric with no value, carrying the reason. */
function withheld(
  key: string,
  label: string,
  unit: Metric['unit'],
  calculation: string,
  source: string[],
  missing: string[],
  status: Metric['provenance']['status'],
  completeness = 0
): Metric {
  return {
    key,
    label,
    value: null,
    unit,
    provenance: { status, calculation, source, missing, completeness },
  }
}

function actual(
  key: string,
  label: string,
  value: number,
  unit: Metric['unit'],
  calculation: string,
  source: string[],
  completeness = 1
): Metric {
  return {
    key,
    label,
    value: round2(value),
    unit,
    provenance: { status: 'actual', calculation, source, missing: [], completeness },
  }
}

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

export interface MetricsResult {
  metrics: Metric[]
  byKey: Record<string, Metric>
  alerts: BusinessAlert[]
  health: HealthIndicator[]
  gaps: DataGap[]
  topProducts: ProductPerformance[]
  /** Every product that sold in the window (not only the top 10). */
  products: ProductPerformance[]
  losingProducts: ProductPerformance[]
  series: DailyPoint[]
}

export function computeBusinessMetrics(inputs: MetricInputs, now: Date = new Date()): MetricsResult {
  const {
    orders,
    items,
    products,
    expenses,
    collections,
    collectionDeductions,
    reconciliations,
    advertising,
    fixedShippingFee,
    businessDate,
    expensesTableIsEmpty = false,
  } = inputs

  const counted = orders.filter(isCountedOrder)
  const countedIds = new Set(counted.map(o => o.id))

  /* ── Sales ─────────────────────────────────────────────────────── */
  const recognizedSales = sum(counted.map(o => o.total_amount))
  const deliveredSales = sum(
    orders.filter(o => o.status === 'delivered').map(o => o.total_amount)
  )
  const shippingCollected = sum(counted.map(o => o.shipping_fee))
  const totalOrders = counted.length

  /* ── Order status split ────────────────────────────────────────── */
  const byStatus = (s: string) => orders.filter(o => o.status === s).length
  const deliveredOrders = byStatus('delivered')
  const pendingOrders = byStatus('pending')
  const confirmedOrders = byStatus('confirmed')
  const shippedOrders = byStatus('shipped')
  const returnedOrders = byStatus('returned')
  const cancelledOrders = byStatus('cancelled')
  const undeliveredOrders = counted.filter(o => o.status !== 'delivered').length

  /* ── Product costs ─────────────────────────────────────────────── */
  const productById = new Map(products.map(p => [p.id, p]))
  const countedItems = items.filter(it => countedIds.has(it.order_id))

  let cogs = 0
  let cogsUnknownLines = 0
  let cogsTotalLines = 0
  let cogsFromSnapshot = 0

  for (const item of countedItems) {
    cogsTotalLines += 1
    const product = item.product_id ? productById.get(item.product_id) : undefined
    const snapshot = item.unit_cost
    const fallback = product?.cost_price ?? null
    const unitCost = snapshot ?? fallback
    if (unitCost === null || unitCost === undefined || unitCost === 0) {
      // A zero is NOT a known cost — it means "nobody entered a cost yet".
      cogsUnknownLines += 1
      cogs += 0
      continue
    }
    if (snapshot !== null && snapshot !== undefined) cogsFromSnapshot += 1
    cogs += (item.quantity || 0) * unitCost
  }

  const cogsComplete = cogsTotalLines === 0 || cogsUnknownLines === 0
  const productsWithoutCost = products.filter(p => !p.cost_price || p.cost_price <= 0)

  /* ── Expenses ──────────────────────────────────────────────────── */
  const activeExpenses = expenses.filter(e => !e.voided_at)
  const expensesTotal = sum(activeExpenses.map(e => e.amount))

  /* ── Advertising ───────────────────────────────────────────────── */
  const adSpend = advertising?.spend ?? null
  const adAvailable = adSpend !== null

  /* ── Shipping cost ─────────────────────────────────────────────── */
  // The real cost of shipping is what the courier deducted from the cash
  // collected. When there is no collection yet, the owner's configured fixed
  // shipping fee per order is the documented fallback.
  const deductionTotal = sum(collectionDeductions.map(d => d.amount))
  const hasCollections = collections.length > 0
  const shippingCost = hasCollections
    ? deductionTotal
    : fixedShippingFee !== null && fixedShippingFee !== undefined
      ? round2(fixedShippingFee * totalOrders)
      : null

  /* ── Cash ──────────────────────────────────────────────────────── */
  const cashCollected = sum(collections.map(c => c.received_amount))
  const cashExpected = sum(collections.map(c => c.expected_amount))
  const cashHeldByCouriers = round2(cashExpected - cashCollected)

  /* ── Returned-orders loss (an ESTIMATE by the owner's own rule) ── */
  const averageOrderValue = totalOrders > 0 ? recognizedSales / totalOrders : 0
  const returnedCount = reconciliations.reduce(
    (s, r) => s + (r.returned_orders_count || 0),
    0
  )
  const returnedLossEstimate = round2(returnedCount * averageOrderValue)

  /* ── Metrics ───────────────────────────────────────────────────── */
  const metrics: Metric[] = []
  const sourceOrders = ['orders']
  const sourceItems = ['order_items', 'products']

  metrics.push(
    actual('revenue', 'صافي المبيعات المحتسبة', recognizedSales, 'currency',
      'مجموع قيمة الطلبات المحتسبة (غير الملغاة وغير المرتجعة)', sourceOrders),
    actual('delivered_revenue', 'مبيعات الطلبات المُسلَّمة', deliveredSales, 'currency',
      'مجموع قيمة الطلبات التي حالتها مُسلَّمة', sourceOrders),
    actual('total_orders', 'إجمالي الطلبات', totalOrders, 'count',
      'عدد الطلبات المحتسبة في الفترة', sourceOrders),
    actual('delivered_orders', 'طلبات مُسلَّمة', deliveredOrders, 'count',
      'عدد الطلبات التي حالتها مُسلَّمة', sourceOrders),
    actual('pending_orders', 'طلبات قيد الانتظار', pendingOrders, 'count',
      'عدد الطلبات التي حالتها قيد الانتظار', sourceOrders),
    actual('shipped_orders', 'طلبات في الطريق', shippedOrders + confirmedOrders, 'count',
      'عدد الطلبات المؤكدة أو في الطريق', sourceOrders),
    actual('returned_orders', 'طلبات مرتجعة', returnedOrders, 'count',
      'عدد الطلبات التي حالتها مرتجعة', sourceOrders),
    actual('undelivered_orders', 'طلبات لم تُسلَّم بعد', undeliveredOrders, 'count',
      'الطلبات المحتسبة التي لم تُسلَّم بعد', sourceOrders),
    actual('cancelled_orders', 'طلبات ملغاة', cancelledOrders, 'count',
      'عدد الطلبات الملغاة', sourceOrders)
  )

  /* Product costs — withheld when the data is incomplete. */
  if (cogsTotalLines === 0) {
    metrics.push(
      withheld('product_costs', 'تكلفة المنتجات', 'currency',
        'مجموع (الكمية × تكلفة الوحدة) لكل سطر طلب',
        sourceItems, ['لا توجد سطور طلبات في الفترة'], 'not_applicable')
    )
  } else if (cogsComplete) {
    metrics.push(
      actual('product_costs', 'تكلفة المنتجات', cogs, 'currency',
        'مجموع (الكمية × تكلفة الوحدة) — سعر التكلفة المثبّت على سطر الطلب، وإلا تكلفة المنتج الحالية',
        sourceItems)
    )
  } else {
    metrics.push(
      withheld('product_costs', 'تكلفة المنتجات', 'currency',
        'مجموع (الكمية × تكلفة الوحدة) لكل سطر طلب',
        sourceItems,
        [
          `${cogsUnknownLines} من ${cogsTotalLines} سطر طلب بدون تكلفة وحدة`,
          productsWithoutCost.length > 0
            ? `${arabicCount(productsWithoutCost.length, 'منتج')} بدون تكلفة مسجّلة`
            : 'تكلفة الوحدة مفقودة على السطر',
        ],
        'incomplete',
        round2((cogsTotalLines - cogsUnknownLines) / cogsTotalLines)
      )
    )
  }

  /* Expenses — actual, unless the store records no expenses at all. */
  if (expensesTableIsEmpty) {
    // Zero recorded expenses is not the same as "the business spends nothing".
    // It means nothing is being recorded, and a profit computed without
    // expenses would over-state the truth.
    metrics.push(
      withheld('operating_expenses', 'المصروفات التشغيلية', 'currency',
        'مجموع المصروفات غير الملغاة في الفترة', ['expenses'],
        ['لا توجد أي مصروفات مسجّلة في النظام — الرقم صفر لأن التسجيل غير منظم، لا لأن الإنفاق صفر'],
        'incomplete')
    )
  } else {
    metrics.push(
      actual('operating_expenses', 'المصروفات التشغيلية', expensesTotal, 'currency',
        'مجموع المصروفات غير الملغاة في الفترة', ['expenses'])
    )
  }

  /* Advertising — unavailable until a platform is connected. */
  if (adAvailable) {
    metrics.push(
      actual('advertising_spend', 'مصروف الإعلانات', adSpend as number, 'currency',
        'مجموع الإنفاق الإعلاني المُبلّغ من المنصة المتصلة', [advertising!.source])
    )
  } else {
    metrics.push(
      withheld('advertising_spend', 'مصروف الإعلانات', 'currency',
        'مجموع الإنفاق الإعلاني المُبلّغ من المنصة المتصلة', [],
        ['لا يوجد اتصال بإعلانات مدفوعة (Meta / TikTok / Google) — لا يمكن قياس الإنفاق'],
        'unavailable')
    )
  }

  /* Shipping — actual from the courier deductions, estimated from the
     configured fixed fee, unavailable when neither exists. */
  if (hasCollections) {
    metrics.push(
      actual('shipping_cost', 'تكلفة الشحن', shippingCost as number, 'currency',
        'مجموع ما خصمته شركات الشحن من التحصيلات', ['collection_deductions'])
    )
  } else if (shippingCost !== null) {
    metrics.push({
      key: 'shipping_cost',
      label: 'تكلفة الشحن',
      value: shippingCost,
      unit: 'currency',
      provenance: {
        status: 'estimated',
        calculation: 'مبلغ الشحن الثابت لكل طلب × عدد الطلبات',
        source: ['business_settings.default_shipping_fee', 'orders'],
        missing: ['لا توجد تحصيلات شركات شحن في الفترة — التكلفة تقديرية من السعر الثابت'],
        completeness: 0.5,
      },
    })
  } else {
    metrics.push(
      withheld('shipping_cost', 'تكلفة الشحن', 'currency',
        'خصومات شركات الشحن من التحصيلات، أو السعر الثابت لكل طلب', [],
        ['لا توجد خصومات شحن ولا سعر شحن ثابت مسجّل'], 'unavailable')
    )
  }

  /* Returned-orders loss — an ESTIMATE, always labelled. */
  if (returnedCount > 0) {
    metrics.push({
      key: 'returned_loss',
      label: 'خسارة المرتجعات (تقديري)',
      value: returnedLossEstimate,
      unit: 'currency',
      provenance: {
        status: 'estimated',
        calculation: 'عدد الطلبات المرتجعة × متوسط قيمة الطلب',
        source: ['daily_reconciliations', 'orders'],
        missing: ['عدد المرتجعات يُسجَّل يدويًا في التسوية اليومية — أي طلب مرتجع بالتحديد غير مُسجَّل'],
        completeness: 0.6,
      },
    })
  } else {
    metrics.push(
      withheld('returned_loss', 'خسارة المرتجعات (تقديري)', 'currency',
        'عدد الطلبات المرتجعة × متوسط قيمة الطلب', ['daily_reconciliations'],
        ['لا توجد تسويات يومية مسجّلة في الفترة'], 'unavailable')
    )
  }

  /* Net profit — withheld unless every input exists. */
  const profitInputsMissing: string[] = []
  if (cogsTotalLines > 0 && !cogsComplete) {
    profitInputsMissing.push('تكلفة المنتجات ناقصة')
  }
  if (!adAvailable) {
    profitInputsMissing.push('مصروف الإعلانات غير متاح')
  }
  if (shippingCost === null) {
    profitInputsMissing.push('تكلفة الشحن غير متاحة')
  }
  if (expensesTableIsEmpty) {
    profitInputsMissing.push('لا تُسجَّل مصروفات في النظام')
  }

  if (profitInputsMissing.length === 0) {
    const netProfit = round2(
      recognizedSales -
        cogs -
        (shippingCost as number) -
        (adSpend as number) -
        expensesTotal -
        returnedLossEstimate
    )
    metrics.push(
      actual('net_profit', 'صافي الربح', netProfit, 'currency',
        'المبيعات المحتسبة − تكلفة المنتجات − تكلفة الشحن − الإعلانات − المصروفات − خسارة المرتجعات',
        [...sourceOrders, ...sourceItems, 'expenses', 'collection_deductions'])
    )
    metrics.push(
      actual('revenue_minus_expenses', 'المبيعات ناقص المصروفات فقط', round2(recognizedSales - expensesTotal),
        'currency',
        'المبيعات المحتسبة − المصروفات التشغيلية (بدون تكلفة المنتجات والشحن والإعلانات)',
        [...sourceOrders, 'expenses'])
    )
  } else {
    metrics.push(
      withheld('net_profit', 'صافي الربح', 'currency',
        'المبيعات المحتسبة − تكلفة المنتجات − تكلفة الشحن − الإعلانات − المصروفات − خسارة المرتجعات',
        [...sourceOrders, ...sourceItems, 'expenses'],
        profitInputsMissing,
        'incomplete'
      )
    )
    // The honest subset — sales minus what we know for sure. It is only
    // honest while the expenses are actually being recorded; otherwise
    // "sales minus expenses" is just "sales", and saying so would hide the
    // very gap that inflates the profit.
    if (expensesTableIsEmpty) {
      metrics.push(
        withheld('revenue_minus_expenses', 'المبيعات ناقص المصروفات فقط', 'currency',
          'المبيعات المحتسبة − المصروفات التشغيلية (بدون تكلفة المنتجات والشحن والإعلانات)',
          [...sourceOrders, 'expenses'],
          ['لا تُسجَّل مصروفات في النظام — الرقم المسحوب (= المبيعات) يبالغ في الأرباح'],
          'incomplete')
      )
    } else {
      metrics.push(
        actual('revenue_minus_expenses', 'المبيعات ناقص المصروفات فقط', round2(recognizedSales - expensesTotal),
          'currency',
          'المبيعات المحتسبة − المصروفات التشغيلية (بدون تكلفة المنتجات والشحن والإعلانات)',
          [...sourceOrders, 'expenses'])
      )
    }
  }

  /* Cash — no collection batches means "not recorded", not "zero collected". */
  if (hasCollections) {
    metrics.push(
      actual('cash_collected', 'المحصّل فعليًا', cashCollected, 'currency',
        'مجموع المبالغ المستلمة فعليًا من شركات الشحن', ['collection_batches'])
    )
    metrics.push(
      actual('cash_held_by_couriers', 'نقدي محتجز لدى شركات الشحن', cashHeldByCouriers, 'currency',
        'المبلغ المتوقع من التحصيلات − المستلم فعليًا', ['collection_batches'])
    )
  } else {
    metrics.push(
      withheld('cash_collected', 'المحصّل فعليًا', 'currency',
        'مجموع المبالغ المستلمة فعليًا من شركات الشحن', ['collection_batches'],
        ['لا توجد دفعات تحصيل مسجّلة — لا يمكن معرفة النقد المحصّل'], 'unavailable')
    )
    metrics.push(
      withheld('cash_held_by_couriers', 'نقدي محتجز لدى شركات الشحن', 'currency',
        'المبلغ المتوقع من التحصيلات − المستلم فعليًا', ['collection_batches'],
        ['لا توجد دفعات تحصيل مسجّلة'], 'unavailable')
    )
  }

  /* Inventory — when the store does not track stock, the quantity is not a
     fact, and the value cannot exist either. */
  const inventoryUnits = products.reduce((s, p) => s + (p.stock_quantity || 0), 0)
  const productsWithCost = products.filter(p => (p.cost_price || 0) > 0)
  const trackedProducts = products.filter(p => p.track_inventory === true)
  const inventoryTracked = trackedProducts.length > 0

  if (products.length === 0) {
    metrics.push(
      withheld('inventory_value', 'قيمة المخزون', 'currency',
        'مجموع (الكمية المتوفرة × تكلفة الوحدة) لكل منتج', ['products'],
        ['لا توجد منتجات'], 'not_applicable')
    )
  } else if (!inventoryTracked) {
    metrics.push(
      withheld('inventory_value', 'قيمة المخزون', 'currency',
        'مجموع (الكمية المتوفرة × تكلفة الوحدة) لكل منتج', ['products'],
        [
          'المخزون غير مُدار في النظام (track_inventory = false لكل المنتجات)',
          ...(productsWithCost.length < products.length
            ? [`${arabicCount(products.length - productsWithCost.length, 'منتج')} من ${products.length} بدون تكلفة`]
            : []),
        ],
        'unavailable')
    )
  } else if (productsWithCost.length === products.length) {
    metrics.push(
      actual('inventory_value', 'قيمة المخزون', sum(products.map(p => (p.stock_quantity || 0) * (p.cost_price || 0))),
        'currency', 'مجموع (الكمية المتوفرة × تكلفة الوحدة) لكل منتج', ['products'])
    )
  } else {
    metrics.push(
      withheld('inventory_value', 'قيمة المخزون', 'currency',
        'مجموع (الكمية المتوفرة × تكلفة الوحدة) لكل منتج', ['products'],
        [`${arabicCount(products.length - productsWithCost.length, 'منتج')} من ${products.length} بدون تكلفة`],
        'incomplete',
        round2(productsWithCost.length / products.length)
      )
    )
  }

  if (inventoryTracked) {
    metrics.push(
      actual('inventory_units', 'عدد الوحدات في المخزون', inventoryUnits, 'count',
        'مجموع الكميات المتوفرة لكل منتج', ['products'])
    )
  } else {
    metrics.push(
      withheld('inventory_units', 'عدد الوحدات في المخزون', 'count',
        'مجموع الكميات المتوفرة لكل منتج', ['products'],
        ['المخزون غير مُدار في النظام — الكميات المسجّلة صفرة لأنها غير مُتبعة'], 'unavailable')
    )
  }

  /* Average order value. */
  metrics.push(
    totalOrders > 0
      ? actual('average_order_value', 'متوسط قيمة الطلب', round2(recognizedSales / totalOrders), 'currency',
          'المبيعات المحتسبة ÷ عدد الطلبات المحتسبة', sourceOrders)
      : withheld('average_order_value', 'متوسط قيمة الطلب', 'currency',
          'المبيعات المحتسبة ÷ عدد الطلبات المحتسبة', sourceOrders,
          ['لا توجد طلبات في الفترة'], 'not_applicable')
  )

  /* Delivery + return rates. */
  if (totalOrders > 0) {
    metrics.push(
      actual('delivery_rate', 'نسبة التسليم', round2((deliveredOrders / totalOrders) * 100), 'percent',
        'الطلبات المُسلَّمة ÷ الطلبات المحتسبة × 100', sourceOrders)
    )
    metrics.push(
      actual('return_rate', 'نسبة المرتجعات', round2((returnedOrders / totalOrders) * 100), 'percent',
        'الطلبات المرتجعة ÷ الطلبات المحتسبة × 100', sourceOrders)
    )
  }

  /* ── Products ──────────────────────────────────────────────────── */
  const productStats = new Map<string, { units: number; revenue: number; cost: number; unknownCost: boolean }>()
  for (const item of countedItems) {
    if (!item.product_id) continue
    const product = productById.get(item.product_id)
    const entry = productStats.get(item.product_id) || { units: 0, revenue: 0, cost: 0, unknownCost: false }
    entry.units += item.quantity || 0
    // Revenue per product is apportioned from the order total by the line's
    // share of the order's net subtotal — the only honest split available
    // when a line carries no explicit selling price.
    const order = counted.find(o => o.id === item.order_id)
    const unitCost = item.unit_cost ?? product?.cost_price ?? null
    const known = unitCost !== null && unitCost !== undefined && unitCost > 0
    if (!known) entry.unknownCost = true
    entry.cost += known ? (item.quantity || 0) * unitCost : 0
    if (order) {
      const orderItems = items.filter(it => it.order_id === order.id)
      const orderUnits = orderItems.reduce((s, it) => s + (it.quantity || 0), 0)
      const share = orderUnits > 0 ? (item.quantity || 0) / orderUnits : 0
      entry.revenue += (order.total_amount || 0) * share
    }
    productStats.set(item.product_id, entry)
  }

  const productPerformance: ProductPerformance[] = []
  for (const [productId, stat] of productStats) {
    const product = productById.get(productId)
    if (!product) continue
    const status: ProductPerformance['status'] = stat.unknownCost ? 'incomplete' : 'actual'
    const margin = stat.unknownCost ? null : round2(stat.revenue - stat.cost)
    productPerformance.push({
      productId,
      name: product.name,
      sku: product.sku,
      units: stat.units,
      revenue: round2(stat.revenue),
      cost: stat.unknownCost ? round2(stat.cost) : round2(stat.cost),
      margin,
      marginPercent:
        margin === null || stat.revenue <= 0 ? null : round2((margin / stat.revenue) * 100),
      status,
    })
  }

  const ranked = [...productPerformance].sort((a, b) => b.revenue - a.revenue)
  const topProducts = ranked.slice(0, 10)
  const losingProducts = productPerformance
    .filter(p => p.margin !== null && p.margin < 0)
    .sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0))

  /* ── Daily series ──────────────────────────────────────────────── */
  const days = new Map<string, DailyPoint>()
  for (const order of counted) {
    const day = businessDate(order.created_at)
    const point = days.get(day) || { date: day, orders: 0, revenue: 0, cost: 0, expenses: 0, profit: null }
    point.orders += 1
    point.revenue += order.total_amount || 0
    days.set(day, point)
  }
  for (const item of countedItems) {
    const order = counted.find(o => o.id === item.order_id)
    if (!order) continue
    const day = businessDate(order.created_at)
    const point = days.get(day)
    if (!point) continue
    const product = item.product_id ? productById.get(item.product_id) : undefined
    const unitCost = item.unit_cost ?? product?.cost_price ?? null
    if (unitCost !== null && unitCost !== undefined && unitCost > 0) {
      point.cost += (item.quantity || 0) * unitCost
    } else {
      point.cost = NaN // marks the day as incomplete
    }
  }
  for (const expense of activeExpenses) {
    if (!expense.expense_date) continue
    const point = days.get(expense.expense_date.slice(0, 10))
    if (!point) continue
    point.expenses += expense.amount || 0
  }
  const series: DailyPoint[] = [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(p => ({
      date: p.date,
      orders: p.orders,
      revenue: round2(p.revenue),
      cost: Number.isNaN(p.cost) ? 0 : round2(p.cost),
      expenses: round2(p.expenses),
      profit: Number.isNaN(p.cost)
        ? null
        : adAvailable
          ? round2(p.revenue - p.cost - p.expenses - (adSpend as number))
          : null,
    }))

  /* ── Gaps ──────────────────────────────────────────────────────── */
  const gaps: DataGap[] = []
  if (!cogsComplete && cogsTotalLines > 0) {
    gaps.push({
      id: 'missing_product_costs',
      severity: 'critical',
      title: 'تكلفة بعض المنتجات غير مسجّلة',
      detail: `${cogsUnknownLines} من ${cogsTotalLines} سطر طلب في الفترة بدون تكلفة وحدة، و${arabicCount(productsWithoutCost.length, 'منتج')} بدون تكلفة. صافي الربح لا يُعرض بدونها.`,
      area: 'finance',
      actionHref: '/settings?tab=products',
    })
  }
  if (!adAvailable) {
    gaps.push({
      id: 'no_advertising_connection',
      severity: 'warning',
      title: 'لا يوجد اتصال بإعلانات مدفوعة',
      detail: 'مصروف الإعلانات غير معروف، لذلك صافي الربح غير مكتمل. اربط Meta أو TikTok أو Google Ads لقياسه.',
      area: 'integrations',
      actionHref: '/settings/integrations',
    })
  }
  if (shippingCost === null) {
    gaps.push({
      id: 'no_shipping_cost',
      severity: 'warning',
      title: 'تكلفة الشحن غير معروفة',
      detail: 'لا توجد خصومات من شركات شحن ولا سعر شحن ثابت مسجّل. سجّل أحدهما لتعرف تكلفة الشحن الحقيقية.',
      area: 'finance',
      actionHref: '/settings',
    })
  }
  if (!hasCollections) {
    gaps.push({
      id: 'no_courier_collections',
      severity: 'info',
      title: 'لا توجد تحصيلات من شركات شحن',
      detail: 'لا يمكن حساب النقدي المحتجز لدى شركات الشحن قبل تسجيل أول دفعة تحصيل.',
      area: 'operations',
      actionHref: '/collections',
    })
  }
  if (reconciliations.length === 0) {
    gaps.push({
      id: 'no_reconciliation',
      severity: 'warning',
      title: 'لا توجد تسوية يومية في الفترة',
      detail: 'خسارة المرتجعات تُقدَّر ولا يمكن احتسابها بدقة قبل تسجيل التسوية اليومية.',
      area: 'operations',
      actionHref: '/reconciliation',
    })
  }
  if (expensesTableIsEmpty) {
    gaps.push({
      id: 'expenses_not_recorded',
      severity: 'critical',
      title: 'لا تُسجَّل مصروفات في النظام إطلاقاً',
      detail:
        'جدول المصروفات فارغ تماماً. أي ربح يُحسب الآن يتجاهل الإيجار والرواتب والتغليف والشحن — أي أنه يقدّر الربح أعلى من الحقيقة.',
      area: 'finance',
      actionHref: '/settings',
    })
  }
  if (products.length > 0 && !inventoryTracked) {
    gaps.push({
      id: 'inventory_not_tracked',
      severity: 'info',
      title: 'المخزون غير مُدار',
      detail:
        'كل المنتجات عليها track_inventory = false، فالكميات المسجّلة صفرة لا تعني "لا يوجد مخزون" بل "الكميات غير مُتبعة".',
      area: 'data',
      actionHref: '/products',
    })
  }

  /* ── Alerts ────────────────────────────────────────────────────── */
  const alerts: BusinessAlert[] = []
  const createdAt = now.toISOString()
  if (!adAvailable) {
    alerts.push({
      id: 'ads_disconnected',
      severity: 'warning',
      title: 'إنفاق الإعلانات غير مرئي',
      detail: 'لا يمكن معرفة صافي الربح الحقيقي قبل ربط منصة الإعلانات.',
      metricKey: 'advertising_spend',
      createdAt,
    })
  }
  if (!cogsComplete && cogsTotalLines > 0) {
    alerts.push({
      id: 'cogs_incomplete',
      severity: 'critical',
      title: 'صافي الربح محجوب لأن تكلفة المنتجات ناقصة',
      detail: `${cogsUnknownLines} سطر طلب بدون تكلفة وحدة. سجّل التكلفة لتظهر الأرباح.`,
      metricKey: 'product_costs',
      createdAt,
    })
  }
  if (cashHeldByCouriers > 0) {
    alerts.push({
      id: 'courier_cash_outstanding',
      severity: 'warning',
      title: 'نقدي غير مُستلَم لدى شركات الشحن',
      detail: `يوجد ${round2(cashHeldByCouriers)} لم يصل إلى الشركة بعد.`,
      metricKey: 'cash_held_by_couriers',
      createdAt,
    })
  }
  if (totalOrders > 0 && returnedOrders / totalOrders > 0.2) {
    alerts.push({
      id: 'high_return_rate',
      severity: 'warning',
      title: 'نسبة مرتجعات مرتفعة',
      detail: `${round2((returnedOrders / totalOrders) * 100)}% من الطلبات مرتجعة.`,
      metricKey: 'return_rate',
      createdAt,
    })
  }

  /* ── Health ────────────────────────────────────────────────────── */
  const health: HealthIndicator[] = []
  health.push({
    key: 'data_completeness',
    label: 'اكتمال البيانات',
    score: Math.round(
      ((cogsComplete ? 1 : 0) + (adAvailable ? 1 : 0) + (shippingCost !== null ? 1 : 0) + (hasCollections ? 1 : 0)) /
        4 *
        100
    ),
    status: cogsComplete && adAvailable ? 'good' : 'attention',
    detail: 'نسبة المكوّنات اللازمة لصافي الربح المتاحة فعليًا.',
  })
  if (totalOrders > 0) {
    const rate = (deliveredOrders / totalOrders) * 100
    health.push({
      key: 'delivery',
      label: 'أداء التسليم',
      score: Math.round(rate),
      status: rate >= 70 ? 'good' : rate >= 50 ? 'attention' : 'critical',
      detail: `${deliveredOrders} طلب مُسلَّم من ${totalOrders}.`,
    })
  }
  if (reconciliations.length > 0) {
    health.push({
      key: 'reconciliation',
      label: 'اكتمال التسويات',
      score: 100,
      status: 'good',
      detail: `${reconciliations.length} تسوية يومية مسجّلة.`,
    })
  } else {
    health.push({
      key: 'reconciliation',
      label: 'اكتمال التسويات',
      score: 0,
      status: 'critical',
      detail: 'لا توجد تسويات يومية مسجّلة.',
    })
  }

  const byKey: Record<string, Metric> = {}
  for (const metric of metrics) byKey[metric.key] = metric

  return {
    metrics,
    byKey,
    alerts,
    health,
    gaps,
    topProducts,
    products: productPerformance,
    losingProducts,
    series,
  }
}

/* ------------------------------------------------------------------ */
/* Comparison with the previous period                                  */
/* ------------------------------------------------------------------ */

/** Attach the previous-period value and the change to each metric. */
export function attachComparison(
  metrics: Metric[],
  previous: Record<string, number | null>
): Metric[] {
  return metrics.map(metric => {
    const before = previous[metric.key]
    if (before === null || before === undefined || metric.value === null) {
      return { ...metric, previous: before ?? null, changePercent: null }
    }
    if (before === 0) {
      return { ...metric, previous: before, changePercent: null }
    }
    const change = round2(((metric.value - before) / Math.abs(before)) * 100)
    return { ...metric, previous: before, changePercent: change }
  })
}
