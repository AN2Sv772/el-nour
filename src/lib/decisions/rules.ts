/**
 * The decision rules — PURE functions over a snapshot of real rows.
 *
 * Every rule answers the same three questions:
 *   1. Does the evidence justify firing? (the condition)
 *   2. What are the exact numbers? (the evidence)
 *   3. What is the owner supposed to do? (the action)
 *
 * A rule that cannot show its numbers does not fire.
 */

import { round2 } from '@/lib/finance'
import { arabicCount, formatCurrency, formatNumber } from '@/lib/utils'
import type { Decision, DecisionEvidence, DecisionSeverity } from './types'

/** The snapshot the rules read — assembled by the engine from real rows. */
export interface DecisionsSnapshot {
  window: { preset: string; label: string; from: string | null; to: string | null }
  orders: {
    id: string
    status: string
    payment_status: string | null
    total_amount: number | null
    shipping_fee: number | null
    created_at: string
  }[]
  /** Orders in the window, counted (not cancelled / returned). */
  countedOrders: number
  /** Orders in the window that reached "delivered". */
  deliveredOrders: number
  /** Orders still open, split by age. */
  backlog: {
    total: number
    value: number
    olderThan30Days: number
    valueOlderThan30Days: number
    olderThan7Days: number
  }
  /** How many orders have a recorded payment. */
  ordersWithPayment: number
  /** Average shipping fee actually collected per order in the window. */
  avgShippingFeeCollected: number | null
  /** The fixed shipping fee configured in business_settings. */
  fixedShippingFee: number | null
  /** True when a courier collection batch exists. */
  hasCollections: boolean
  /** True when a daily reconciliation exists in the window. */
  hasReconciliation: boolean
  /** True when the `expenses` table holds no rows at all. */
  expensesNotRecorded: boolean
  /** True when an advertising platform is connected. */
  adsConnected: boolean
  /** Products that sold in the window without a known cost. */
  blindProducts: { productId: string; name: string; units: number; revenue: number }[]
  /** Revenue of the products above. */
  blindRevenue: number
  /** Revenue share of the single best product (null when there is no revenue). */
  topProductShare: number | null
  /** Recognised revenue in the window. */
  revenue: number
  /** Whether the profit could be stated (all its inputs are facts). */
  profitStated: boolean
  /** When the snapshot was taken. */
  now: Date
}

function money(value: number): string {
  return formatCurrency(value)
}

function percent(value: number): string {
  return `${round2(value)}%`
}

/** Sort by severity, then by how much is at stake. */
export function sortDecisions(decisions: Decision[]): Decision[] {
  const order: Record<DecisionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
  return [...decisions].sort((a, b) => order[a.severity] - order[b.severity])
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

/** R1 — Old orders nobody has moved. */
function ruleBacklog(snapshot: DecisionsSnapshot): Decision | null {
  const { backlog } = snapshot
  if (backlog.olderThan30Days === 0) return null

  const severity: DecisionSeverity =
    backlog.valueOlderThan30Days >= 100_000 ? 'critical' : backlog.olderThan30Days >= 50 ? 'high' : 'medium'

  const evidence: DecisionEvidence[] = [
    {
      label: 'طلبات مفتوحة أكثر من 30 يوماً',
      value: arabicCount(backlog.olderThan30Days, 'طلب'),
      source: ['orders'],
    },
    {
      label: 'قيمتها الإجمالية',
      value: money(backlog.valueOlderThan30Days),
      source: ['orders.total_amount'],
    },
    {
      label: 'إجمالي الطلبات المفتوحة',
      value: `${arabicCount(backlog.total, 'طلب')} بقيمة ${money(backlog.value)}`,
      source: ['orders'],
    },
  ]

  return {
    id: 'aged_backlog',
    severity,
    confidence: 'high',
    title: 'طلبات مفتوحة تجاوزت شهراً',
    why: `${formatNumber(backlog.olderThan30Days)} طلب ما زالت حالتها "قيد الانتظار" منذ أكثر من 30 يوماً، وقيمتها ${money(backlog.valueOlderThan30Days)}. كل طلب لا يُسلَّم لا يعود نقداً للمتجر.`,
    evidence,
    impact: `تحصيل ${money(backlog.valueOlderThan30Days)} نقداً هو الأثر المحتمل — لكنه لا يتحقق إلا بالتسليم.`,
    action: { label: 'راجع الطلبات المفتوحة', href: '/orders?status=pending' },
    rule: 'R-BACKLOG-30D',
  }
}

/** R2 — Nothing has been delivered at all. */
function ruleNoDelivery(snapshot: DecisionsSnapshot): Decision | null {
  if (snapshot.countedOrders === 0) return null
  if (snapshot.deliveredOrders > 0) return null

  const share = (snapshot.deliveredOrders / snapshot.countedOrders) * 100
  return {
    id: 'no_deliveries',
    severity: 'critical',
    confidence: 'high',
    title: 'لا يوجد أي طلب مُسلَّم في الفترة',
    why: `من ${formatNumber(snapshot.countedOrders)} طلب في "${snapshot.window.label}" لا يوجد ولا طلب واحد حالته "مُسلَّم" (نسبة التسليم ${percent(share)}).`,
    evidence: [
      {
        label: 'الطلبات المحتسبة',
        value: arabicCount(snapshot.countedOrders, 'طلب'),
        source: ['orders'],
      },
      {
        label: 'الطلبات المُسلَّمة',
        value: '0 طلب',
        source: ['orders.status'],
      },
    ],
    impact: 'لا يمكن أن يظهر نقد محصّل فعلياً قبل تسجيل التسليمات ودفعات التحصيل.',
    action: { label: 'سجّل التسليمات', href: '/orders' },
    rule: 'R-NO-DELIVERY',
  }
}

/** R3 — No payment is recorded on any order. */
function ruleNoPayment(snapshot: DecisionsSnapshot): Decision | null {
  if (snapshot.countedOrders === 0) return null
  if (snapshot.ordersWithPayment === snapshot.countedOrders) return null

  const missing = snapshot.countedOrders - snapshot.ordersWithPayment
  const status = snapshot.ordersWithPayment === 0 ? 'critical' : 'medium'

  return {
    id: 'payments_not_recorded',
    severity: status,
    confidence: 'high',
    title: 'حالة الدفع غير مسجّلة على الطلبات',
    why: `${formatNumber(missing)} من ${formatNumber(snapshot.countedOrders)} طلب لا تحمل حالة دفع ("${snapshot.ordersWithPayment === 0 ? 'لا يوجد أي طلب مدفوع' : 'بعض الطلبات فقط'}"). المبيعات المحتسبة ${money(snapshot.revenue)} لا تعني أن هذا المبلغ وصل.`,
    evidence: [
      { label: 'طلبات بلا حالة دفع', value: arabicCount(missing, 'طلب'), source: ['orders.payment_status'] },
      { label: 'المبيعات المحتسبة', value: money(snapshot.revenue), source: ['orders.total_amount'] },
    ],
    impact: 'فرّق المبيعات عن النقد: المبيعات رقم، والنقد رقم آخر لا يُعرف بدون دفعات التحصيل.',
    action: { label: 'حدّث حالات الدفع', href: '/orders' },
    rule: 'R-NO-PAYMENT',
  }
}

/** R4 — The configured shipping fee does not match what is actually collected. */
function ruleShippingFee(snapshot: DecisionsSnapshot): Decision | null {
  const avg = snapshot.avgShippingFeeCollected
  const configured = snapshot.fixedShippingFee
  if (avg === null || configured === null || configured <= 0) return null
  if (avg <= configured * 1.15) return null

  // How much of the real shipping cost the configured fee actually covers.
  const coverage = (configured / avg) * 100
  const suggestion = round2(avg)

  return {
    id: 'shipping_fee_underestimated',
    severity: 'medium',
    confidence: 'medium',
    title: 'سعر الشحن المُعدّ أقل من المحصّل فعلياً',
    why: `المتجر يحصّل في المتوسط ${money(avg)} رسوم شحن لكل طلب، بينما السعر الثابت في الإعدادات ${money(configured)}. كل تقدير لتكلفة الشحن يعتمد على الرقم الأقل، فيقلّل تقدير التكلفة بنحو ${percent(100 - coverage)}.`,
    evidence: [
      {
        label: 'متوسط رسوم الشحن المحصّلة',
        value: `${money(avg)} لكل طلب`,
        source: ['orders.shipping_fee'],
      },
      {
        label: 'السعر الثابت في الإعدادات',
        value: `${money(configured)} لكل طلب`,
        source: ['business_settings.default_shipping_fee'],
      },
    ],
    impact: `تصحيح السعر الثابت إلى ${money(suggestion)} يجعل تقدير تكلفة الشحن أقرب للحقيقة.`,
    action: {
      label: `اقترح ضبط السعر على ${suggestion} ج.م`,
      proposal: {
        type: 'set_business_setting',
        title: `ضبط سعر الشحن الثابت على ${suggestion} ج.م`,
        description: `متوسط رسوم الشحن المحصّلة فعلياً ${money(avg)} لكل طلب، والسعر الحالي ${money(configured)}.`,
        payload: { key: 'default_shipping_fee', value: suggestion },
        impactSummary:
          'يؤثر على تقدير تكلفة الشحن في كل المقاييس وقائمة الدخل. يعتمد على متوسط الرسوم المحصّلة، وهو تقدير لا بديل عن تسجيل خصومات شركات الشحن الفعلية.',
      },
    },
    rule: 'R-SHIPPING-RATE',
  }
}

/** R5 — Revenue was earned by products nobody priced. */
function ruleMissingCosts(snapshot: DecisionsSnapshot): Decision | null {
  if (snapshot.blindProducts.length === 0) return null

  return {
    id: 'missing_product_costs',
    severity: 'critical',
    confidence: 'high',
    title: 'منتجات بيعت بدون تكلفة مسجّلة',
    why: `${arabicCount(snapshot.blindProducts.length, 'منتج')} باع بمبيعات ${money(snapshot.blindRevenue)}، ولا يوجد مسجّل أي تكلفة لها. الربح المبدئي والهامش لكل منتج محجوبان بسبب ذلك.`,
    evidence: [
      {
        label: 'منتجات بلا تكلفة',
        value: arabicCount(snapshot.blindProducts.length, 'منتج'),
        source: ['products.cost_price', 'order_items'],
      },
      {
        label: 'مبيعاتها',
        value: money(snapshot.blindRevenue),
        source: ['order_items', 'orders.total_amount'],
      },
    ],
    impact: null,
    action: {
      label: 'سجّل تكلفة المنتجات',
      href: '/agent',
    },
    rule: 'R-MISSING-COSTS',
  }
}

/** R6 — Expenses are not being recorded at all. */
function ruleExpensesNotRecorded(snapshot: DecisionsSnapshot): Decision | null {
  if (!snapshot.expensesNotRecorded) return null

  return {
    id: 'expenses_not_recorded',
    severity: 'critical',
    confidence: 'high',
    title: 'المصروفات غير مسجّلة في النظام إطلاقاً',
    why: 'جدول المصروفات فارغ تماماً. أي ربح يُحسب الآن يتجاهل الإيجار والرواتب والتغليف والشحن — أي أنه يقدّر الربح أعلى من الحقيقة.',
    evidence: [
      { label: 'عدد المصروفات المسجّلة', value: '0', source: ['expenses'] },
    ],
    impact: null,
    action: {
      label: 'سجّل أول مصروف',
      proposal: {
        type: 'add_expense',
        title: 'تسجيل مصروف تشغيلي',
        description: 'إضافة أول سطر مصروف إلى النظام حتى تصبح الأرباح المحسوبة واقعية.',
        payload: {
          amount: 0,
          category: 'other',
          expense_date: snapshot.now.toISOString().slice(0, 10),
          notes: 'أول مصروف تشغيلي مسجّل',
        },
        impactSummary: 'يفتح campo احتساب المصروفات التشغيلية، ويجعل رقم الربح قابلاً للاعتماد بدل أن يكون تقديراً ناقصاً.',
      },
    },
    rule: 'R-EXPENSES-EMPTY',
  }
}

/** R7 — No advertising source, so no ROAS can ever be computed. */
function ruleNoAds(snapshot: DecisionsSnapshot): Decision | null {
  if (snapshot.adsConnected) return null

  return {
    id: 'ads_not_connected',
    severity: 'info',
    confidence: 'high',
    title: 'لا يوجد مصدر إعلانات متصل',
    why: 'لا يمكن حساب العائد على الإنفاق الإعلاني (ROAS) ولا تكلفة الطلب من الإعلانات، لأن المنصة لم تُتصل بعد. المصروف الإعلاني يظهر "غير متاح" في كل الشاشات.',
    evidence: [
      { label: 'مصدر الإعلانات المتصل', value: 'لا يوجد', source: ['integrations'] },
    ],
    impact: null,
    action: { label: 'اتصل بمنصة إعلانات', href: '/settings/integrations' },
    rule: 'R-NO-ADS',
  }
}

/** R8 — Cash was never reconciled with the couriers. */
function ruleNoCollections(snapshot: DecisionsSnapshot): Decision | null {
  if (snapshot.hasCollections) return null
  if (snapshot.countedOrders === 0) return null

  return {
    id: 'no_collections',
    severity: 'high',
    confidence: 'high',
    title: 'لا توجد دفعات تحصيل من شركات الشحن',
    why: `المتجر يحصّل نقداً من ${formatNumber(snapshot.countedOrders)} طلب، ولا توجد دفعة تحصيل مسجّلة واحدة. لذلك "المحصّل فعلياً" و"المستحق من شركات الشحن" غير معروفين.`,
    evidence: [
      { label: 'دفعات التحصيل المسجّلة', value: '0', source: ['collection_batches'] },
      { label: 'طلبات في الفترة', value: arabicCount(snapshot.countedOrders, 'طلب'), source: ['orders'] },
    ],
    impact: null,
    action: { label: 'سجّل دفعة تحصيل', href: '/collections' },
    rule: 'R-NO-COLLECTIONS',
  }
}

/** R9 — Daily reconciliation missing ⇒ the return loss is unknown. */
function ruleNoReconciliation(snapshot: DecisionsSnapshot): Decision | null {
  if (snapshot.hasReconciliation) return null
  if (snapshot.countedOrders === 0) return null

  return {
    id: 'no_daily_reconciliation',
    severity: 'medium',
    confidence: 'high',
    title: 'لا توجد تسوية يومية في الفترة',
    why: 'خسارة المرتجعات تُقدَّر ولا تُعرف بدقّة قبل تسجيل التسوية اليومية. المتجر كله يعمل بالدفع عند الاستلام، فالمُرجَع غير المحصّل هو ملك شركة الشحن لا المتجر.',
    evidence: [
      { label: 'تسويات مسجّلة', value: '0', source: ['daily_reconciliations'] },
    ],
    impact: null,
    action: { label: 'سجّل التسوية اليومية', href: '/reconciliation' },
    rule: 'R-NO-RECONCILIATION',
  }
}

/** R10 — The revenue depends on one product. */
function ruleConcentration(snapshot: DecisionsSnapshot): Decision | null {
  const share = snapshot.topProductShare
  if (share === null || share < 40) return null

  return {
    id: 'revenue_concentration',
    severity: 'medium',
    confidence: 'medium',
    title: 'المبيعات تتركّز على منتج واحد',
    why: `أفضل منتج يمثّل ${percent(share)} من مبيعات المنتجات. لو توقّف بيعه، تتأثر معظم المبيعات مباشرة.`,
    evidence: [
      { label: 'حصة أفضل منتج', value: percent(share), source: ['order_items', 'orders.total_amount'] },
    ],
    impact: null,
    action: { label: 'راجع اقتصاديات المنتجات', href: '/analytics' },
    rule: 'R-CONCENTRATION',
  }
}

/** R11 — Almost nothing has been delivered. */
function ruleUndeliveredShare(snapshot: DecisionsSnapshot): Decision | null {
  if (snapshot.countedOrders === 0) return null
  const delivered = snapshot.deliveredOrders
  const undelivered = snapshot.countedOrders - delivered
  const share = (undelivered / snapshot.countedOrders) * 100
  if (share < 90) return null

  return {
    id: 'undelivered_share',
    severity: 'high',
    confidence: 'high',
    title: 'نسبة الطلبات غير المُسلَّمة تجاوزت 90%',
    why: `${undelivered} من ${snapshot.countedOrders} طلب في "${snapshot.window.label}" لم تُسلَّم (${percent(share)}). المبيعات في النظام لا تعني نقداً في البنك.`,
    evidence: [
      { label: 'طلبات لم تُسلَّم', value: `${formatNumber(undelivered)} من ${formatNumber(snapshot.countedOrders)}`, source: ['orders.status'] },
    ],
    impact: null,
    action: { label: 'راجع الطلبات', href: '/orders' },
    rule: 'R-UNDELIVERED-SHARE',
  }
}

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

const RULES = [
  ruleNoDelivery,
  ruleBacklog,
  ruleNoPayment,
  ruleExpensesNotRecorded,
  ruleMissingCosts,
  ruleNoCollections,
  ruleUndeliveredShare,
  ruleShippingFee,
  ruleNoReconciliation,
  ruleConcentration,
  ruleNoAds,
]

/** Run every rule over the snapshot and return the decisions that fired. */
export function evaluateDecisions(snapshot: DecisionsSnapshot): Decision[] {
  const decisions: Decision[] = []
  for (const rule of RULES) {
    const decision = rule(snapshot)
    if (decision) decisions.push(decision)
  }
  return sortDecisions(decisions)
}
