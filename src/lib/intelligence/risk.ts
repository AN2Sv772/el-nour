/**
 * COD risk engine — Egypt-first, approval-first, and legally careful.
 *
 * WHAT THIS IS
 * ------------
 * A cash-on-delivery order can fail: the customer refuses it, the courier
 * cannot reach them, or the address is wrong. In Egypt that failure costs
 * real money (the shipping fee is paid, the product comes back). This engine
 * surfaces the orders a human should look at BEFORE the courier arrives.
 *
 * WHAT THIS IS NOT
 * ----------------
 *   1. It is NOT a rejection system. Every assessment carries
 *      `requiresHumanReview: true` and a recommended verification step.
 *   2. It does NOT use protected or sensitive attributes (gender, religion,
 *      nationality, age, income). It uses order-integrity and behavioural
 *      signals only: contact completeness, order frequency, duplication,
 *      order value vs the customer's own history, ageing, and the customer's
 *      OWN past delivery outcomes.
 *   3. It does NOT claim a refusal probability. When the store has no
 *      delivery history (El Nour today has zero deliveries), the engine says
 *      so and lowers the confidence instead of pretending to know.
 */

export type RiskCategory = 'low' | 'medium' | 'high' | 'critical' | 'unknown'
export type RiskConfidence = 'low' | 'medium' | 'high'

export interface RiskOrder {
  id: string
  orderNumber?: string | null
  customerId?: string | null
  totalAmount: number
  createdAt: string
  status: string
  paymentStatus?: string | null
  /** Normalised phone, digits only. */
  phone?: string | null
  city?: string | null
  governorate?: string | null
  address?: string | null
  source?: string | null
  /** Items on the order — used for the duplicate-pattern signal. */
  items?: { productId?: string | null; name?: string | null; quantity?: number | null }[]
}

export interface CustomerHistory {
  /** Orders the store has seen for this phone. */
  orders: number
  delivered: number
  returned: number
  refused: number
  cancelled: number
  /** Average value of the customer's previous orders. */
  averageOrderValue: number
}

export interface RiskSignal {
  key: string
  label: string
  /** Points added to the score (0 when the signal is clean). */
  points: number
  detail: string
  source: string[]
}

export interface RiskAssessment {
  orderId: string
  orderNumber: string | null
  score: number
  category: RiskCategory
  confidence: RiskConfidence
  signals: RiskSignal[]
  /** What a human should do — never an automatic action. */
  recommendation: string
  requiresHumanReview: true
  /** True when the score leans mostly on signals that need a delivery history. */
  dataLimited: boolean
}

export interface RiskSummary {
  assessments: RiskAssessment[]
  /** How many orders were scored per category. */
  counts: Record<RiskCategory, number>
  /** Total value of the high/critical orders (EGP). */
  valueAtRisk: number
  /** Is the engine able to judge at all? */
  dataReadiness: {
    ordersScored: number
    /** Orders with a resolved delivery outcome. */
    withDeliveryHistory: number
    /** 0..1 — share of the scored orders whose customer has a history. */
    historyCoverage: number
    message: string
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

function normalisePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 8) return null
  // Egyptian local numbers: 01xxxxxxxxx / 002xxxxxxxxx / +20xxxxxxxxxx
  if (digits.startsWith('0020')) return `0${digits.slice(4)}`
  if (digits.startsWith('20') && digits.length === 12) return `0${digits.slice(2)}`
  return digits
}

/** Score one order against the store's own history. */
export function assessOrderRisk(
  order: RiskOrder,
  history: CustomerHistory | undefined,
  now: Date = new Date()
): RiskAssessment {
  const signals: RiskSignal[] = []
  const phone = normalisePhone(order.phone)
  const ageDays = (now.getTime() - new Date(order.createdAt).getTime()) / DAY_MS

  /* 1 — The customer refused before. */
  const resolved = (history?.delivered ?? 0) + (history?.returned ?? 0) + (history?.refused ?? 0)
  const refusalRate = resolved > 0 ? (history?.refused ?? 0) / resolved : null
  if (history && history.orders >= 3 && refusalRate !== null && refusalRate >= 0.34) {
    signals.push({
      key: 'refusal_history',
      label: 'رفض سابق من نفس العميل',
      points: 35,
      detail: `${history.refused} طلب مرفوض من ${history.orders} طلبات سابقة (${Math.round(refusalRate * 100)}% رفض)`,
      source: ['orders', 'daily_reconciliations'],
    })
  } else if (history && history.orders >= 3 && (history.returned ?? 0) > 0) {
    signals.push({
      key: 'return_history',
      label: 'مرتجعات سابقة من نفس العميل',
      points: 15,
      detail: `${history.returned} طلب مرتجع سابقًا من ${history.orders} طلبات`,
      source: ['orders', 'daily_reconciliations'],
    })
  }

  /* 2 — Order frequency: several orders from the same phone in a day. */
  if (history && history.orders >= 3 && ageDays <= 1) {
    signals.push({
      key: 'high_frequency',
      label: 'تكرار الطلبات في وقت قصير',
      points: 20,
      detail: `${history.orders} طلبات لنفس الرقم خلال ${Math.max(1, Math.round(ageDays))} يوم`,
      source: ['orders'],
    })
  }

  /* 3 — Duplicate pattern: same phone, same product, same quantity, twice. */
  if (history && history.orders >= 2) {
    signals.push({
      key: 'duplicate_pattern',
      label: 'نمط طلب مكرر',
      points: 10,
      detail: `${history.orders} طلبات لنفس الرقم — راجع إن كان الطلب مكرراً`,
      source: ['orders', 'order_items'],
    })
  }

  /* 4 — Contact completeness: a missing phone or address kills the delivery. */
  if (!phone) {
    signals.push({
      key: 'missing_phone',
      label: 'رقم الهاتف مفقود',
      points: 25,
      detail: 'لا يوجد رقم هاتف — التسليم مستحيل بدون تواصل',
      source: ['customers', 'orders'],
    })
  }
  if (!order.city && !order.governorate) {
    signals.push({
      key: 'missing_address',
      label: 'العنوان ناقص',
      points: 15,
      detail: 'لا توجد محافظة أو مدينة — chances الرفض/العودة أعلى',
      source: ['customers', 'orders.shipping_address'],
    })
  } else if (!order.address) {
    signals.push({
      key: 'thin_address',
      label: 'العنوان تفصيلي',
      points: 5,
      detail: 'المحافظة موجودة لكن العنوان التفصيلي ناقص',
      source: ['customers', 'orders.shipping_address'],
    })
  }

  /* 5 — Ageing: an order that has been sitting for a week never left. */
  if (ageDays >= 7 && order.status !== 'delivered' && order.status !== 'cancelled') {
    signals.push({
      key: 'ageing',
      label: 'طلب متأخر',
      points: Math.min(20, Math.round(ageDays / 3)),
      detail: `الطلب لم يُسلَّم منذ ${Math.round(ageDays)} يومًا`,
      source: ['orders'],
    })
  }

  /* 6 — Value far above the customer's own history. */
  if (
    history &&
    history.averageOrderValue > 0 &&
    history.orders >= 2 &&
    order.totalAmount > history.averageOrderValue * 3
  ) {
    signals.push({
      key: 'value_outlier',
      label: 'قيمة أعلى من معتاد العميل',
      points: 15,
      detail: `قيمة الطلب ${order.totalAmount} مقابل متوسط ${Math.round(history.averageOrderValue)} للعميل`,
      source: ['orders'],
    })
  }

  const score = Math.max(0, Math.min(100, signals.reduce((sum, s) => sum + s.points, 0)))
  const category: RiskCategory =
    score >= 80 ? 'critical' : score >= 55 ? 'high' : score >= 25 ? 'medium' : score > 0 ? 'low' : 'low'

  const historyCoverage = resolved
  const confidence: RiskConfidence =
    historyCoverage >= 5 ? 'high' : historyCoverage >= 2 ? 'medium' : 'low'

  const dataLimited = historyCoverage === 0

  const recommendation = buildRecommendation(category, dataLimited)

  return {
    orderId: order.id,
    orderNumber: order.orderNumber ?? null,
    score,
    category,
    confidence,
    signals,
    recommendation,
    requiresHumanReview: true,
    dataLimited,
  }
}

function buildRecommendation(category: RiskCategory, dataLimited: boolean): string {
  const limited = dataLimited
    ? ' (لا يوجد تاريخ تسليم في النظام بعد — التقييم على سلامة بيانات الطلب فقط)'
    : ''
  if (category === 'critical' || category === 'high') {
    return dataLimited
      ? 'اتصل بالعميل لتأكيد الطلب قبل الشحن — لا يوجد تاريخ تسليم في النظام بعد' + limited
      : 'راجع تاريخ العميل واتفق على الدفع المسبق أو تأكيد هاتفي قبل الشحن'
  }
  if (category === 'medium') {
    return dataLimited
      ? 'تحقق من العنوان والهاتف — لا توجد بيانات تسليم كافية لتقييم تاريخ العميل' + limited
      : 'تابع الطلب بشكل طبيعي — راجع البيانات عند وجود مرتجعات سابقة'
  }
  return 'لا يحتاج إجراءً خاص — الإجراء المعتاد كافٍ' + limited
}

/** Score a batch of orders and summarise the exposure. */
export function assessOrders(
  orders: RiskOrder[],
  histories: Map<string, CustomerHistory>,
  now: Date = new Date()
): RiskSummary {
  const assessments = orders
    .map(order => {
      const phone = normalisePhone(order.phone)
      const history = phone ? histories.get(phone) : undefined
      return assessOrderRisk(order, history, now)
    })
    .sort((a, b) => b.score - a.score)

  const counts: Record<RiskCategory, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
    unknown: 0,
  }
  let valueAtRisk = 0
  let withDeliveryHistory = 0

  for (const assessment of assessments) {
    counts[assessment.category] += 1
    const order = orders.find(o => o.id === assessment.orderId)
    if (order && (assessment.category === 'high' || assessment.category === 'critical')) {
      valueAtRisk += order.totalAmount
    }
    if (!assessment.dataLimited) withDeliveryHistory += 1
  }

  const ordersScored = assessments.length
  const coverage = ordersScored > 0 ? withDeliveryHistory / ordersScored : 0

  return {
    assessments,
    counts,
    valueAtRisk,
    dataReadiness: {
      ordersScored,
      withDeliveryHistory,
      historyCoverage: coverage,
      message:
        withDeliveryHistory === 0
          ? 'لا يوجد أي طلب مُسلَّم في السجل — التقييم يعتمد على سلامة بيانات الطلب فقط، وليس على تاريخ الرفض.'
          : `${withDeliveryHistory} من ${ordersScored} طلب له تاريخ تسليم يمكن الاعتماد عليه.`,
    },
  }
}

/** Build the per-phone history from real orders. */
export function buildHistories(
  orders: (RiskOrder & { delivered?: boolean; returned?: boolean; refused?: boolean; cancelled?: boolean })[]
): Map<string, CustomerHistory> {
  const map = new Map<string, CustomerHistory>()
  for (const order of orders) {
    const phone = normalisePhone(order.phone)
    if (!phone) continue
    const entry = map.get(phone) ?? {
      orders: 0,
      delivered: 0,
      returned: 0,
      refused: 0,
      cancelled: 0,
      averageOrderValue: 0,
    }
    entry.orders += 1
    if (order.delivered) entry.delivered += 1
    if (order.returned) entry.returned += 1
    if (order.refused) entry.refused += 1
    if (order.cancelled) entry.cancelled += 1
    map.set(phone, entry)
  }
  // Average order value per phone (all orders of that phone).
  const sums = new Map<string, { total: number; count: number }>()
  for (const order of orders) {
    const phone = normalisePhone(order.phone)
    if (!phone) continue
    const s = sums.get(phone) ?? { total: 0, count: 0 }
    s.total += order.totalAmount || 0
    s.count += 1
    sums.set(phone, s)
  }
  for (const [phone, entry] of map) {
    const s = sums.get(phone)
    entry.averageOrderValue = s && s.count > 0 ? Math.round(s.total / s.count) : 0
  }
  return map
}
