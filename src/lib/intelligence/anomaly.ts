/**
 * Anomaly detection — "what changed, by how much, and what to check".
 *
 * The rules are deliberately boring and explainable: a median/MAD check on
 * the daily series, plus a set of structural checks that only fire when the
 * data genuinely says something is off (no deliveries at all, shipping fees
 * that disagree with the configured fee, orders that never move to a paid
 * state, a backlog that keeps growing).
 *
 * Two rules keep it honest:
 *   1. Small samples never raise an alarm (a store with 3 days of data does
 *      not get "revenue crashed" alerts).
 *   2. Every anomaly carries the baseline, the actual value, the affected
 *      record count and what to check — never a diagnosis presented as fact.
 */

export type AnomalySeverity = 'critical' | 'warning' | 'info'

export interface Anomaly {
  id: string
  severity: AnomalySeverity
  title: string
  /** What changed, in one sentence. */
  what: string
  /** The expected/normal value. */
  baseline: string
  /** The observed value. */
  actual: string
  /** How many records are involved. */
  affected: number
  /** What could explain it — hypotheses, not verdicts. */
  possibleCauses: string[]
  /** The first thing to check. */
  recommendedAction: string
  /** Where the owner should look. */
  href?: string
}

export interface AnomalyInput {
  /** Daily series: date, orders, revenue. */
  series: { date: string; orders: number; revenue: number }[]
  /** All-time order counters for the window. */
  totalOrders: number
  deliveredOrders: number
  pendingOrders: number
  ordersWithoutPaymentState: number
  /** Average shipping fee actually charged vs the configured one. */
  averageShippingFee: number | null
  configuredShippingFee: number | null
  /** Share of the revenue coming from the top product (0..1). */
  topProductShare: number | null
  /** 0..1 — how complete the underlying data is. */
  dataCompleteness: number | null
  /** Orders created before this many days that are still not delivered. */
  agedOrders: number
  agedValue: number
}

const MIN_DAYS_FOR_TREND = 7

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Median absolute deviation — robust against the outlier we are looking for. */
function mad(values: number[]): number {
  if (values.length === 0) return 0
  const med = median(values)
  return median(values.map(v => Math.abs(v - med)))
}

function fmt(n: number): string {
  return new Intl.NumberFormat('ar-EG-u-nu-latn', { maximumFractionDigits: 2 }).format(n)
}

/** Detect the anomalies that the data actually supports. */
export function detectAnomalies(input: AnomalyInput): Anomaly[] {
  const anomalies: Anomaly[] = []

  /* 1 — Nothing is being delivered. */
  if (input.totalOrders > 0 && input.deliveredOrders === 0) {
    anomalies.push({
      id: 'no_deliveries',
      severity: 'critical',
      title: 'لا يوجد أي طلب مُسلَّم',
      what: `كل ${fmt(input.totalOrders)} طلب في الفترة ما زالت غير مُسلَّمة`,
      baseline: 'توصيل جزء من الطلبات',
      actual: '0 طلب مُسلَّم',
      affected: input.totalOrders,
      possibleCauses: [
        'حالة الطلبات لا تتحدّث من EasyOrders (تكامل متوقف)',
        'التوصيل لا يتم فعلاً',
        'التسوية اليومية لا تُسجَّل',
      ],
      recommendedAction: 'تحقق من آخر مزامنة من EasyOrders ومن حالة الطلبات يدويًا قبل أي قرار مالي',
      href: '/settings/integrations',
    })
  }

  /* 2 — No order ever reaches a paid state. */
  if (input.totalOrders > 0 && input.ordersWithoutPaymentState === input.totalOrders) {
    anomalies.push({
      id: 'no_payment_state',
      severity: 'warning',
      title: 'حالة الدفع لا تتغيّر على أي طلب',
      what: `${fmt(input.totalOrders)} طلب بقيمة ${fmt(input.ordersWithoutPaymentState)} بدون حالة دفع`,
      baseline: 'الدفع يُحدَّث عند التحصيل',
      actual: 'كل الطلبات pending',
      affected: input.totalOrders,
      possibleCauses: ['ش companies الشحن لا ترسل تحديثات الدفع', 'التحديثات تصل ولا تُحفظ'],
      recommendedAction: 'تحقق من حفظ تحديثات حالة الدفع من شركات الشحن',
      href: '/collections',
    })
  }

  /* 3 — The shipping fee charged disagrees with the configured fee. */
  if (
    input.averageShippingFee !== null &&
    input.configuredShippingFee !== null &&
    input.configuredShippingFee > 0 &&
    input.totalOrders > 0
  ) {
    const diff = input.averageShippingFee - input.configuredShippingFee
    const ratio = input.averageShippingFee / input.configuredShippingFee
    if (Math.abs(diff) >= 1 && (ratio > 1.15 || ratio < 0.85)) {
      anomalies.push({
        id: 'shipping_fee_mismatch',
        severity: 'warning',
        title: 'رسوم الشحن المحصَّلة لا تطابق المعتمد',
        what: `المحصّل فعليًا ${fmt(input.averageShippingFee)} ج.م/طلب مقابل ${fmt(input.configuredShippingFee)} ج.م معتمدة`,
        baseline: `${fmt(input.configuredShippingFee)} ج.م لكل طلب`,
        actual: `${fmt(input.averageShippingFee)} ج.م لكل طلب`,
        affected: input.totalOrders,
        possibleCauses: [
          'رسوم الشحن تُحتسب من zones الشحن الفعلية وليست الثابتة',
          'شركات الشحن تخصم رسوم خدمة إضافية',
          'الإعداد القديم ما زال معتمدًا في مكان آخر',
        ],
        recommendedAction: 'اعتمد السعر الفعلي في التكلفة أو صحّح مصدر الرسوم — لا تستخدم الرقم القديم في حساب الربح',
        href: '/settings',
      })
    }
  }

  /* 4 — The backlog keeps growing (second half of the window > first half). */
  if (input.series.length >= MIN_DAYS_FOR_TREND) {
    const mid = Math.floor(input.series.length / 2)
    const first = input.series.slice(0, mid)
    const second = input.series.slice(mid)
    const firstAvg = first.reduce((s, d) => s + d.orders, 0) / Math.max(1, first.length)
    const secondAvg = second.reduce((s, d) => s + d.orders, 0) / Math.max(1, second.length)
    if (firstAvg > 0 && secondAvg > firstAvg * 1.5) {
      anomalies.push({
        id: 'backlog_growth',
        severity: 'warning',
        title: 'تراكم الطلبات في تزايد',
        what: `متوسط الطلبات اليومي ارتفع من ${fmt(firstAvg)} إلى ${fmt(secondAvg)}`,
        baseline: `${fmt(firstAvg)} طلب/يوم`,
        actual: `${fmt(secondAvg)} طلب/يوم`,
        affected: input.pendingOrders,
        possibleCauses: ['تسويق مكثّف بدون ميزانية شحن', 'طاقة التوصيل أقل من الطلب', 'تأخر المعالجة'],
        recommendedAction: 'وازن بين حجم الطلبات وطاقة التسليم — الطلب غير المُسلَّم يُفقد الشحن والمبيعات',
      })
    }
  }

  /* 5 — A day that is far outside the normal band.
     Leave-one-out: the candidate day is excluded from its own baseline, so a
     single spike cannot inflate the deviation and hide itself. */
  if (input.series.length >= MIN_DAYS_FOR_TREND) {
    for (const day of input.series) {
      const others = input.series.filter(d => d.date !== day.date).map(d => d.revenue)
      if (others.length < 3) continue
      const baseMedian = median(others)
      const baseMad = mad(others)
      const flagged =
        baseMad > 0
          ? Math.abs(day.revenue - baseMedian) / (1.4826 * baseMad) >= 3.5
          : baseMedian > 0 && Math.abs(day.revenue - baseMedian) / baseMedian >= 0.5
      if (flagged) {
        anomalies.push({
          id: `day_outlier_${day.date}`,
          severity: 'info',
          title: `يوم ${day.date} خارج النطاق المعتاد`,
          what: `مبيعات ${fmt(day.revenue)} ج.م في يوم واحد`,
          baseline: `${fmt(Math.round(baseMedian))} ج.م (وسيط المبيعات اليومية بدون هذا اليوم)`,
          actual: `${fmt(day.revenue)} ج.م`,
          affected: day.orders,
          possibleCauses: [
            'حملة إعلانية أو عرض ترويجي',
            'دفعة طلبات متأخرة سُجّلت في يوم واحد',
            'خطأ في تسجيل المبالغ',
          ],
          recommendedAction: 'قارن اليوم بعملية بيع أو حملة معروفة قبل اعتباره نمطاً',
        })
      }
    }
  }

  /* 6 — The revenue depends on a single product. */
  if (input.topProductShare !== null && input.topProductShare >= 0.6 && input.totalOrders > 5) {
    anomalies.push({
      id: 'product_concentration',
      severity: 'info',
      title: 'التركيز على منتج واحد',
      what: `${Math.round(input.topProductShare * 100)}% من المبيعات من منتج واحد`,
      baseline: 'توزيع متوازن نسبيًا',
      actual: `${Math.round(input.topProductShare * 100)}% من منتج واحد`,
      affected: input.totalOrders,
      possibleCauses: ['منتج واحد هو البطل فعلاً', 'بقية المنتجات غير متاحة أو غير مروجة'],
      recommendedAction: 'تابع ما إذا كان المنتج البطل متاحًا — نفاد مخزونه يوقف المبيعات كلها',
      href: '/products',
    })
  }

  /* 7 — Old orders that never moved. */
  if (input.agedOrders > 0) {
    anomalies.push({
      id: 'aged_orders',
      severity: 'warning',
      title: 'طلبات قديمة لم تُسلَّم',
      what: `${fmt(input.agedOrders)} طلب أقدم من 30 يومًا بقيمة ${fmt(input.agedValue)} ج.م`,
      baseline: 'لا توجد طلبات عالقة',
      actual: `${fmt(input.agedOrders)} طلب عالق`,
      affected: input.agedOrders,
      possibleCauses: ['رفض العميل', 'تعذر الوصول', 'الطلب لم يُشحن أصلاً'],
      recommendedAction: 'راجع القائمة وأغلق أو جدّد الطلبات المتروكة — كل يوم إضافي يزيد احتمال الرفض',
      href: '/orders',
    })
  }

  /* 8 — The data itself is too incomplete to trust. */
  if (input.dataCompleteness !== null && input.dataCompleteness < 0.5) {
    anomalies.push({
      id: 'low_data_completeness',
      severity: 'warning',
      title: 'اكتمال البيانات منخفض',
      what: `اكتمال البيانات ${Math.round(input.dataCompleteness * 100)}%`,
      baseline: '90%+ لاكتمال البيانات',
      actual: `${Math.round(input.dataCompleteness * 100)}%`,
      affected: input.totalOrders,
      possibleCauses: ['تكاليف غير مسجّلة', 'مصروفات غير مسجّلة', 'تحصيلات غير مسجّلة'],
      recommendedAction: 'أكمل التسجيل أولاً — كل رقم مالي مبني على بيانات ناقصة رقم ناقص',
      href: '/setup/costs',
    })
  }

  const order: Record<AnomalySeverity, number> = { critical: 0, warning: 1, info: 2 }
  return anomalies.sort((a, b) => order[a.severity] - order[b.severity])
}
