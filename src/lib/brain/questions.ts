/**
 * The Brain's question catalogue.
 *
 * These are the questions ONLY THE OWNER can answer — the ones no table and
 * no API can reveal. Each one is tied to a topic and to an area, and each one
 * says why it matters, because an unanswered question that nobody understands
 * is just noise.
 *
 * The catalogue is CODE, not data: it is versioned with the product, and the
 * owner's answers live in `business_brain_questions`. That way the coverage
 * percentage has a stable denominator and a new release can add questions
 * without touching the owner's answers.
 */

export interface BrainQuestionDefinition {
  key: string
  topic: string
  prompt: string
  prompt_ar: string
  why_it_matters: string
  area: string
  required: boolean
  check_in_months?: number | null
}

export const BRAIN_AREAS: { key: string; label: string; label_ar: string; description: string }[] = [
  {
    key: 'business_basics',
    label: 'Business basics',
    label_ar: 'أساسيات النشاط',
    description: 'What the business is, who it serves, and through which channels.',
  },
  {
    key: 'customers',
    label: 'Customers',
    label_ar: 'العملاء',
    description: 'Who buys, how they behave, and what brings them back.',
  },
  {
    key: 'products',
    label: 'Products',
    label_ar: 'المنتجات',
    description: 'The catalogue, the variants, and what each item is for.',
  },
  {
    key: 'pricing',
    label: 'Pricing & margins',
    label_ar: 'التسعير والهوامش',
    description: 'How prices are set and what margin the store protects.',
  },
  {
    key: 'costs',
    label: 'Costs',
    label_ar: 'التكاليف',
    description: 'What every order costs to fulfil. Without these, profit is withheld.',
  },
  {
    key: 'marketing',
    label: 'Marketing',
    label_ar: 'التسويق',
    description: 'Where orders come from, and what may be spent to get more.',
  },
  {
    key: 'operations',
    label: 'Operations',
    label_ar: 'العمليات',
    description: 'How an order moves from the store to the customer.',
  },
  {
    key: 'cash_returns',
    label: 'Cash & returns',
    label_ar: 'النقد والمرتجعات',
    description: 'Money in hand, money with couriers, and what returns cost.',
  },
]

export const BRAIN_QUESTIONS: BrainQuestionDefinition[] = [
  // ── business_basics ────────────────────────────────────────────────────────
  {
    key: 'business_description',
    topic: 'business_basics',
    prompt: 'Describe the business in your own words: what you sell, to whom, and why they choose you.',
    prompt_ar: 'اكتب وصف النشاط بكلماتك: ما الذي تبيعه، ولمن، ولماذا يختارك العميل؟',
    why_it_matters: 'Every answer the agent gives starts from this description. Without it, it guesses.',
    area: 'business_basics',
    required: true,
  },
  {
    key: 'primary_focus',
    topic: 'business_basics',
    prompt: 'What matters most right now: growth, profit, or cash?',
    prompt_ar: 'ما الأولوية الآن: النمو أم الربح أم النقد المتاح؟',
    why_it_matters: 'It decides which metric leads the dashboard and which suggestions the agent makes.',
    area: 'business_basics',
    required: true,
  },
  {
    key: 'sales_channels',
    topic: 'business_basics',
    prompt: 'Which channels do you sell through, and how much does each one matter?',
    prompt_ar: 'ما قنوات البيع التي تعمل بها، وكم أهمية كل قناة؟',
    why_it_matters: 'Channel mix explains why revenue moves even when nothing changed in the store.',
    area: 'business_basics',
    required: true,
  },
  {
    key: 'market_areas',
    topic: 'business_basics',
    prompt: 'Which governorates or cities do you actually serve?',
    prompt_ar: 'ما المحافظات أو المدن التي تخدمها فعلاً؟',
    why_it_matters: 'It sets the shipping reality: what a delivery costs and when a courier refuses it.',
    area: 'business_basics',
    required: false,
  },

  // ── customers ──────────────────────────────────────────────────────────────
  {
    key: 'customer_profile',
    topic: 'customers',
    prompt: 'Who is your typical customer — age, city, and what they buy?',
    prompt_ar: 'من هو عميلك النموذجي: العمر، المدينة، وما الذي يشتريه؟',
    why_it_matters: 'Targeting, packaging and shipping choices all follow from this.',
    area: 'customers',
    required: true,
  },
  {
    key: 'customer_service',
    topic: 'customers',
    prompt: 'What do customers ask for most, and how do you usually answer them?',
    prompt_ar: 'ما أكثر ما يسأل عنه العملاء، وكيف تجيبهم عادةً؟',
    why_it_matters: 'It becomes the assistant\'s voice and the FAQ it can answer without you.',
    area: 'customers',
    required: false,
  },
  {
    key: 'repeat_purchase',
    topic: 'customers',
    prompt: 'What makes a customer come back — and how often do they?',
    prompt_ar: 'ما الذي يجعل العميل يعود، وكم مرة يعود؟',
    why_it_matters: 'Retention is usually cheaper than acquisition, and the agent flags when it slips.',
    area: 'customers',
    required: false,
  },

  // ── products ───────────────────────────────────────────────────────────────
  {
    key: 'product_families',
    topic: 'products',
    prompt: 'Group your products into families and say what each family is for.',
    prompt_ar: 'قسّم منتجاتك إلى مجموعات ووضّح وظيفة كل مجموعة.',
    why_it_matters: 'It lets the agent reason about a product family instead of a list of SKUs.',
    area: 'products',
    required: true,
  },
  {
    key: 'best_sellers',
    topic: 'products',
    prompt: 'Which products do you consider your best sellers, and why?',
    prompt_ar: 'ما المنتجات التي تراها الأفضل مبيعاً، ولماذا؟',
    why_it_matters: 'The data shows what sold; you know why it sold. Both are needed.',
    area: 'products',
    required: false,
  },
  {
    key: 'stock_policy',
    topic: 'products',
    prompt: 'When should a product be hidden from the store, and who decides?',
    prompt_ar: 'متى يُخفى المنتج من المتجر، ومن يقرّر ذلك؟',
    why_it_matters: 'It becomes a rule the agent can propose — with your approval — instead of a surprise.',
    area: 'products',
    required: false,
  },

  // ── pricing ────────────────────────────────────────────────────────────────
  {
    key: 'pricing_method',
    topic: 'pricing',
    prompt: 'How do you set prices: cost plus, market comparison, or fixed?',
    prompt_ar: 'كيف تُحدّد الأسعار: بالتكلفة، بمقارنة السوق، أم بسعر ثابت؟',
    why_it_matters: 'It explains price movements and keeps suggestions consistent with your method.',
    area: 'pricing',
    required: true,
  },
  {
    key: 'target_margin',
    topic: 'pricing',
    prompt: 'What margin do you insist on per order, and what is the lowest you accept?',
    prompt_ar: 'ما هامش الربح الذي تصرّ على تحقيقه في الطلب، وما أدنى هامش تقبله؟',
    why_it_matters: 'It is the threshold the agent uses when it suggests a discount.',
    area: 'pricing',
    required: true,
  },
  {
    key: 'discount_rules',
    topic: 'pricing',
    prompt: 'What discounts are allowed, and what is forbidden?',
    prompt_ar: 'ما الخصومات المسموحة، وما الممنوعة؟',
    why_it_matters: 'A rule written once is a rule applied every time, without an approval each time.',
    area: 'pricing',
    required: true,
  },

  // ── costs ──────────────────────────────────────────────────────────────────
  {
    key: 'landed_cost',
    topic: 'costs',
    prompt: 'What does one unit really cost you — purchase, packaging, and preparation?',
    prompt_ar: 'ما التكلفة الحقيقية للقطعة الواحدة: الشراء، التغليف، والتجهيز؟',
    why_it_matters: 'Without it, profit and margin are withheld. This is the single biggest gap.',
    area: 'costs',
    required: true,
  },
  {
    key: 'shipping_cost',
    topic: 'costs',
    prompt: 'What does shipping cost you per order, and who collects it?',
    prompt_ar: 'كم يكلّفك الشحن لكل طلب، ومن يتحصّله؟',
    why_it_matters: 'Shipping often eats the margin on cash-on-delivery orders.',
    area: 'costs',
    required: true,
  },
  {
    key: 'fixed_costs',
    topic: 'costs',
    prompt: 'What are your fixed monthly costs (rent, salaries, subscriptions)?',
    prompt_ar: 'ما تكاليفك الثابتة الشهرية (الإيجار، الرواتب، الاشتراكات)؟',
    why_it_matters: 'It turns a daily number into a monthly reality.',
    area: 'costs',
    required: false,
  },

  // ── marketing ──────────────────────────────────────────────────────────────
  {
    key: 'acquisition_channels',
    topic: 'marketing',
    prompt: 'Where do your customers actually come from?',
    prompt_ar: 'من أين يأتي عملاؤك فعلياً؟',
    why_it_matters: 'It tells the agent which channel to protect and which to question.',
    area: 'marketing',
    required: true,
  },
  {
    key: 'ad_budget',
    topic: 'marketing',
    prompt: 'What is your daily advertising budget, and what is the ceiling you refuse to cross?',
    prompt_ar: 'ما ميزانية الإعلانات اليومية، وما السقف الذي ترفض تجاوزه؟',
    why_it_matters: 'It becomes a hard constraint on every advertising suggestion.',
    area: 'marketing',
    required: true,
  },
  {
    key: 'what_works',
    topic: 'marketing',
    prompt: 'Which campaign, creative or offer actually worked for you?',
    prompt_ar: 'ما الحملة أو الإعلان أو العرض الذي نجح فعلاً؟',
    why_it_matters: 'Past proof beats a generic suggestion.',
    area: 'marketing',
    required: false,
  },

  // ── operations ─────────────────────────────────────────────────────────────
  {
    key: 'order_flow',
    topic: 'operations',
    prompt: 'Walk me through what happens between a customer paying and the courier arriving.',
    prompt_ar: 'اشرح ما يحدث بين لحظة دفع العميل ووصول المندوب.',
    why_it_matters: 'It is the ground truth for every operational question.',
    area: 'operations',
    required: true,
  },
  {
    key: 'courier_arrangement',
    topic: 'operations',
    prompt: 'Which couriers do you work with, and how is cash collected from them?',
    prompt_ar: 'مع أي شركات توصيل تعمل، وكيف يُحصَّل النقد منها؟',
    why_it_matters: 'Cash in couriers is money you have not received yet.',
    area: 'operations',
    required: true,
  },
  {
    key: 'delivery_times',
    topic: 'operations',
    prompt: 'What delivery time do you promise, and what is actually normal?',
    prompt_ar: 'ما مدة التوصيل التي تَعِد بها، وما الواقع المعتاد؟',
    why_it_matters: 'It sets the deadline for every "where is my order" question.',
    area: 'operations',
    required: false,
  },

  // ── cash_returns ───────────────────────────────────────────────────────────
  {
    key: 'payment_methods',
    topic: 'cash_returns',
    prompt: 'Which payment methods do you accept, and what share of orders is cash on delivery?',
    prompt_ar: 'ما طرق الدفع المقبولة، وما نسبة الطلبات والدفع عند الاستلام؟',
    why_it_matters: 'Cash-on-delivery orders carry a return risk the agent must account for.',
    area: 'cash_returns',
    required: true,
  },
  {
    key: 'return_rate',
    topic: 'cash_returns',
    prompt: 'What return rate is normal for you, and what causes most returns?',
    prompt_ar: 'ما معدل المرتجعات الطبيعي عندك، وما أكثر أسبابها؟',
    why_it_matters: 'A rising return rate is an early warning before it becomes a loss.',
    area: 'cash_returns',
    required: true,
  },
  {
    key: 'cash_floor',
    topic: 'cash_returns',
    prompt: 'What is the minimum cash balance the business must always keep?',
    prompt_ar: 'ما الحد الأدنى من النقد الذي يجب أن يحتفظ به العمل دائماً؟',
    why_it_matters: 'It becomes a hard rule the agent checks before suggesting anything risky.',
    area: 'cash_returns',
    required: true,
  },
]

export const BRAIN_QUESTION_BY_KEY = new Map(BRAIN_QUESTIONS.map(q => [q.key, q]))

/** The topics the knowledge items are filed under (one per question topic). */
export const BRAIN_TOPICS = Array.from(new Set(BRAIN_QUESTIONS.map(q => q.topic)))
