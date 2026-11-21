/**
 * Intent detection — the part of the agent that works with NO model.
 *
 * WHY
 * ---
 * The store has no AI provider configured today. That must not make the
 * assistant useless: the questions a store owner asks most often ("what were
 * my sales last month?", "how much cash is with the couriers?") are not
 * language problems, they are data problems. The engine already knows how to
 * compute every metric, so the agent can DETECT the intent, run the real
 * tool, and answer with real numbers — no model required.
 *
 * The LLM (when a provider is configured) sits on top of this: it handles the
 * questions that are genuinely about language, and it must never invent a
 * number that did not come from a tool.
 *
 * Everything in this file is pure and testable.
 */

export type AgentIntent =
  | 'sales_total'
  | 'profit'
  | 'orders_count'
  | 'order_value'
  | 'cash_with_couriers'
  | 'cash_collected'
  | 'shipping_cost'
  | 'inventory'
  | 'product_performance'
  | 'losing_products'
  | 'brain_status'
  | 'data_gaps'
  | 'decisions'
  | 'compare_periods'
  | 'unknown'

export interface DetectedIntent {
  intent: AgentIntent
  /** The date preset the question refers to, when it could be detected. */
  preset: string | null
  /**
   * A SECOND period named in the question ("قارن هذا الشهر بالشهر الماضي").
   * When it exists, the answer must compare the two named periods — not the
   * engine's automatic "previous equal-length window", which is a different
   * thing and must not be presented as one.
   */
  comparePreset: string | null
  /** 0..1 — how confident the detection is. */
  confidence: number
  /** The matched keywords, for the audit trail of the answer. */
  matched: string[]
}

/** The presets the agent understands, mapped to the shared date engine. */
const PERIOD_KEYWORDS: { preset: string; keywords: string[] }[] = [
  { preset: 'today', keywords: ['اليوم', 'النهارده', 'today', 'يومي'] },
  { preset: 'yesterday', keywords: ['أمس', 'امبارح', 'yesterday'] },
  { preset: 'this_week', keywords: ['هذا الأسبوع', 'الأسبوع هذا', 'this week'] },
  { preset: 'last_week', keywords: ['الأسبوع الماضي', 'اسبوع امبارح', 'last week'] },
  { preset: 'this_month', keywords: ['هذا الشهر', 'الشهر هذا', 'الشهر الحالي', 'this month'] },
  { preset: 'last_month', keywords: ['الشهر الماضي', 'الشهر الماضى', 'last month'] },
  { preset: 'last_7_days', keywords: ['آخر 7 أيام', 'آخر سبعة أيام', 'اخر ٧ ايام', 'last 7 days', 'الأسبوع الأخير'] },
  { preset: 'last_30_days', keywords: ['آخر 30 يومًا', 'آخر 30 يوم', 'اخر ٣٠ يوم', 'آخر شهر', 'اخر شهر', 'last 30 days', 'الشهر الأخير'] },
  { preset: 'this_year', keywords: ['هذا العام', 'السنة دي', 'this year'] },
]

const INTENT_KEYWORDS: { intent: AgentIntent; keywords: string[]; weight: number }[] = [
  { intent: 'profit', keywords: ['ربح', 'ارباح', 'أرباح', 'الربح', 'profit', 'صافي', 'هامش'], weight: 1 },
  { intent: 'shipping_cost', keywords: ['شحن', 'توصيل', 'shipping', 'delivery cost'], weight: 1 },
  { intent: 'cash_with_couriers', keywords: ['عند شركة الشحن', 'عند شركات الشحن', 'مع المندوب', 'لدى الشحن', 'مستحق من الشحن', 'نقد محتجز'], weight: 1.2 },
  { intent: 'cash_collected', keywords: ['تحصيل', 'المحصّل', 'المحصلي', 'collected', 'نقد محصل'], weight: 1.2 },
  { intent: 'inventory', keywords: ['مخزون', 'المخزون', 'inventory', 'stock', 'بضاعة'], weight: 1 },
  { intent: 'losing_products', keywords: ['خسارة', 'خاسر', 'منتج خاسر', 'loss-making', 'منتجاته الخاسرة', 'بخسارة'], weight: 1.2 },
  { intent: 'product_performance', keywords: ['المنتجات', 'منتجات', 'products', 'أفضل منتج', 'أعلى منتج', 'best product', 'توزيع المبيعات على'], weight: 1 },
  { intent: 'order_value', keywords: ['متوسط قيمة الطلب', 'متوسط الطلب', 'average order', 'قيمة الطلب', 'سعر الطلب'], weight: 1.2 },
  { intent: 'orders_count', keywords: ['كم طلب', 'عدد الطلبات', 'الطلبات', 'orders', 'طلبية'], weight: 0.8 },
  { intent: 'compare_periods', keywords: ['مقارنة', 'مقارنة بال', 'مقارنة مع', 'compared to', 'عن الفترة السابقة', 'قبل كام يوم'], weight: 1.2 },
  { intent: 'brain_status', keywords: ['عقل النشاط', 'ماذا يعرف', 'Brain', 'التنمية', 'المعرفة', 'معلومات النظام'], weight: 1.2 },
  { intent: 'decisions', keywords: ['ماذا افعل', 'ماذا يجب ان افعل', 'القرارات', 'قرار', 'الأولويات', 'اولويات', 'ماذا يجب', 'what should i do', 'decisions', 'خطوات'], weight: 1.3 },
  { intent: 'data_gaps', keywords: ['ناقص', 'ناقصة', 'ينقص', 'ما ينقص', 'ماذا ينقص', 'ما هو ناقص', 'مشكلة', 'problems', 'gaps', 'لماذا محجوب'], weight: 1.2 },
  { intent: 'sales_total', keywords: ['مبيعات', 'المبيعات', 'sales', 'دخل', 'الإيراد', 'إيرادات', 'كيف much', 'كم بعت'], weight: 0.9 },
]

/** Normalize Arabic orthography so "الارباح" and "الأرباح" match. */
export function normalizeArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function detectIntent(question: string): DetectedIntent {
  const normalized = normalizeArabic(question)

  // Every period named in the question, in the order they appear.
  const mentionedPresets: string[] = []
  const mentionedAt: { preset: string; index: number }[] = []
  for (const entry of PERIOD_KEYWORDS) {
    for (const keyword of entry.keywords) {
      const index = normalized.indexOf(normalizeArabic(keyword))
      if (index !== -1) {
        mentionedAt.push({ preset: entry.preset, index })
        break
      }
    }
  }
  mentionedAt.sort((a, b) => a.index - b.index)
  for (const item of mentionedAt) {
    if (!mentionedPresets.includes(item.preset)) mentionedPresets.push(item.preset)
  }

  const preset = mentionedPresets[0] ?? null
  const comparePreset = mentionedPresets[1] ?? null

  const scores = new Map<AgentIntent, number>()
  const matchedByIntent = new Map<AgentIntent, string[]>()

  for (const entry of INTENT_KEYWORDS) {
    for (const keyword of entry.keywords) {
      const normalizedKeyword = normalizeArabic(keyword)
      if (normalized.includes(normalizedKeyword)) {
        scores.set(entry.intent, (scores.get(entry.intent) ?? 0) + entry.weight)
        const list = matchedByIntent.get(entry.intent) ?? []
        list.push(keyword)
        matchedByIntent.set(entry.intent, list)
      }
    }
  }

  if (scores.size === 0) {
    return { intent: 'unknown', preset, comparePreset, confidence: 0, matched: [] }
  }

  // "profit" beats "sales" when both appear: "أرباح المبيعات" is about profit.
  const priority: AgentIntent[] = ['profit', 'cash_with_couriers', 'cash_collected', 'losing_products', 'order_value', 'shipping_cost', 'decisions', 'brain_status', 'data_gaps', 'compare_periods', 'product_performance', 'inventory', 'orders_count', 'sales_total']

  let best: AgentIntent = 'unknown'
  let bestScore = 0
  for (const intent of priority) {
    const score = scores.get(intent) ?? 0
    if (score > bestScore) {
      best = intent
      bestScore = score
    }
  }

  const total = [...scores.values()].reduce((a, b) => a + b, 0)
  const confidence = total === 0 ? 0 : Math.min(1, bestScore / total)

  return {
    intent: best,
    preset,
    comparePreset,
    confidence,
    matched: matchedByIntent.get(best) ?? [],
  }
}
