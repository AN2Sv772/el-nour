/**
 * The Brain audit — a deterministic, AI-free audit.
 *
 * It answers three questions with real evidence:
 *   1. What does the business know, and how much of it is verified?
 *   2. Which of the required answers are still missing?
 *   3. Which numbers in the store are still incomplete (and therefore
 *      withheld from the dashboards)?
 *
 * It never invents a finding: every item in the report points at a table, a
 * row or a question key.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { computeBrainStatus, readBrainRows, type BrainStatusReport } from './status'

export interface AuditFinding {
  id: string
  severity: 'info' | 'warning' | 'critical'
  area: string
  title: string
  detail: string
  fix: string
  evidence: string
}

export interface AuditReport {
  status: BrainStatusReport['status']
  statusLabel: string
  coverage: number
  answered: number
  answerable: number
  findings: AuditFinding[]
  dataCompleteness: {
    key: string
    label: string
    complete: boolean
    evidence: string
    impact: string
  }[]
  generatedAt: string
}

interface ProductCostRow {
  id: string
  name: string
  cost_price: number | string | null
}

interface OrderRow {
  id: string
  status: string
  created_at: string
}

/**
 * Run the audit.
 *
 * `null` comes back when the Brain tables are not in the database yet — the
 * caller then says "not configured" instead of pretending to have audited.
 */
export async function runBrainAudit(
  db: SupabaseClient,
  now = new Date()
): Promise<AuditReport | null> {
  const rows = await readBrainRows(db)
  if (!rows) return null

  const report = computeBrainStatus({
    profile: rows.profile,
    questions: rows.questions,
    knowledge: rows.knowledge,
    lastRun: rows.lastRun,
    now,
  })

  const findings: AuditFinding[] = []

  // 1) The profile itself.
  if (!rows.profile) {
    findings.push({
      id: 'missing_profile',
      severity: 'critical',
      area: 'business_basics',
      title: 'ملف النشاط غير موجود',
      detail: 'لا يوجد صف في business_profile، لذلك لا يعرف النظام اسم النشاط أو قواعده.',
      fix: 'أنشئ ملف النشاط من صفحة "ملف النشاط".',
      evidence: 'business_profile → 0 rows',
    })
  } else {
    const p = rows.profile
    const missing: string[] = []
    if (!p.primary_focus) missing.push('الأولوية (نمو/ربح/نقد)')
    if (!p.goals_summary) missing.push('ملخص الأهداف')
    if ((p.never_rules ?? []).length === 0) missing.push('قواعد "لا تفعل"')
    if ((p.hard_constraints ?? []).length === 0) missing.push('القيود الصارمة')
    if (p.cash_floor === null || p.cash_floor === undefined) missing.push('حد النقد الأدنى')
    if (p.max_daily_ad_spend === null || p.max_daily_ad_spend === undefined)
      missing.push('سقف الإنفاق الإعلاني اليومي')

    if (missing.length > 0) {
      findings.push({
        id: 'incomplete_contract',
        severity: 'warning',
        area: 'business_basics',
        title: 'عقد التشغيل غير مكتمل',
        detail: `الحقول الفارغة: ${missing.join('، ')}.`,
        fix: 'أكمل هذه الحقول في ملف النشاط — هي التي تمنع الوكيل من اقتراح قرار مخالف.',
        evidence: 'business_profile → profile row',
      })
    }
  }

  // 2) Open required questions.
  const openQuestions = report.gaps.filter(g => g.kind === 'open_question')
  if (openQuestions.length > 0) {
    findings.push({
      id: 'open_questions',
      severity: openQuestions.length >= 5 ? 'critical' : 'warning',
      area: 'questions',
      title: `${openQuestions.length} سؤالاً مفتوحاً`,
      detail: 'الأسئلة المفتوحة هي المعرفة التي لا يستطيع أي جدول أن يجيب عنها.',
      fix: 'أجب عنها من صفحة "أسئلة لك" — كل إجابة ترفع التغطية.',
      evidence: openQuestions.map(g => g.questionKey).join(', '),
    })
  }

  // 3) Conflicted / outdated knowledge.
  const conflicted = report.gaps.filter(g => g.kind === 'conflicted')
  if (conflicted.length > 0) {
    findings.push({
      id: 'conflicted_knowledge',
      severity: 'critical',
      area: 'knowledge',
      title: `${conflicted.length} معلومة متعارضة`,
      detail: 'معلومتان تقولان شيئين مختلفاً. النظام لا يختار تلقائياً.',
      fix: 'راجع العناصر المتعارضة وقرار أيها صحيح.',
      evidence: conflicted.map(g => g.knowledgeId).join(', '),
    })
  }

  const outdated = report.gaps.filter(g => g.kind === 'outdated')
  if (outdated.length > 0) {
    findings.push({
      id: 'outdated_knowledge',
      severity: 'warning',
      area: 'knowledge',
      title: `${outdated.length} معلومة تحتاج تحديثاً`,
      detail: 'معلومات تجاوزت موعد مراجعتها أو انتهت صلاحيتها.',
      fix: 'راجعها وحدّثها أو أعد التحقق منها.',
      evidence: outdated.map(g => g.knowledgeId).join(', '),
    })
  }

  // 4) The DATA completeness — this is what makes profit show up or not.
  const [products, orders] = await Promise.all([
    fetchAllRows<ProductCostRow>((f, t) =>
      db.from('products').select('id,name,cost_price').order('id', { ascending: true }).range(f, t)
    ),
    fetchAllRows<OrderRow>((f, t) =>
      db.from('orders').select('id,status,created_at').order('id', { ascending: true }).range(f, t)
    ),
  ])

  const productsWithoutCost = products.filter(p => {
    const cost = Number(p.cost_price ?? 0)
    return !Number.isFinite(cost) || cost <= 0
  })

  const dataCompleteness: AuditReport['dataCompleteness'] = [
    {
      key: 'product_costs',
      label: 'تكلفة المنتجات',
      complete: products.length > 0 && productsWithoutCost.length === 0,
      evidence:
        products.length === 0
          ? 'products → 0 rows'
          : `${productsWithoutCost.length} من ${products.length} منتجاً بلا تكلفة`,
      impact: 'بدون التكلفة لا يُعرض صافي الربح ولا هامش الربح — الأرقام تبقى محجوبة عمداً.',
    },
    {
      key: 'orders',
      label: 'الطلبات',
      complete: orders.length > 0,
      evidence: `orders → ${orders.length} rows`,
      impact: 'الإيرادات والحسابات كلها تعتمد على الطلبات.',
    },
    {
      key: 'advertising',
      label: 'الإعلانات',
      complete: false,
      evidence: 'لا يوجد حساب إعلاني متصل.',
      impact: 'إنفاق الإعلانات غير معروف ⇒ صافي الربح الكامل محجوب، ويعرض بدلاً منه الإيراد ناقص المصروفات.',
    },
  ]

  if (productsWithoutCost.length > 0) {
    findings.push({
      id: 'missing_product_costs',
      severity: 'critical',
      area: 'costs',
      title: `${productsWithoutCost.length} منتجاً بلا تكلفة`,
      detail:
        'التكلفة صفر تُعامل كـ"غير معروفة" وليست "مجاناً". لهذا السبب يُحجب صافي الربح بدل عرض رقم خاطئ.',
      fix: 'أدخل تكلفة الشراء لكل منتج من صفحة المنتجات، أو ارفع ملف التسعيرة إلى الـBrain.',
      evidence: productsWithoutCost.slice(0, 20).map(p => p.name || p.id).join('، '),
    })
  }

  findings.push({
    id: 'advertising_not_connected',
    severity: 'warning',
    area: 'marketing',
    title: 'لا يوجد اتصال إعلاني',
    detail: 'إنفاق الإعلانات غير معروف، لذلك لا يمكن احتساب ربح صافٍ كامل.',
    fix: 'اربط حساب الإعلانات من صفحة "الاتصالات" عندما تتوفر البيانات.',
    evidence: 'advertising_accounts → not connected',
  })

  return {
    status: report.status,
    statusLabel: report.statusLabel,
    coverage: report.coverage,
    answered: report.answered,
    answerable: report.answerable,
    findings,
    dataCompleteness,
    generatedAt: now.toISOString(),
  }
}
