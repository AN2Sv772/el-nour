/**
 * The deterministic answer builder.
 *
 * This is what the agent answers with TODAY, with no AI provider connected.
 * It is not a fallback that pretends to be an AI: it runs the real tool,
 * formats the real numbers, shows the real calculation, and lists the real
 * reasons a number could not be produced.
 *
 * When a provider IS configured, the model may rephrase this answer — but it
 * may never introduce a number that is not in `evidence`.
 */

import { formatCurrency, formatNumber } from '@/lib/utils'
import type { BusinessOverview, Metric } from '@/lib/metrics/types'
import type { AgentIntent } from './intent'
import type { ToolEvidence, ToolResult } from './tools'

export interface AgentAnswer {
  /** The answer text (Arabic). */
  text: string
  /** The status of the answer itself. */
  status: 'answered' | 'partially_answered' | 'insufficient_data' | 'calculation_unavailable' | 'unable_to_retrieve'
  /** The numbers the answer is based on. */
  evidence: {
    calculation: string
    sources: string[]
    missing: string[]
    metrics: { key: string; label: string; value: number | null; unit: string; status: string }[]
  }
  /** What the agent could not do, in plain words. */
  followUps: string[]
  /** The tool that produced the answer (for the audit trail). */
  tool: string
}

/**
 * The same formatter the screens use.
 *
 * The agent used to print "٣١٥٬٨٨٠٫٠٠ ج.م." while the cockpit printed
 * "315,880 ج.م" — the same number, two spellings, one owner.
 */
function formatMetric(metric: Metric): string {
  if (metric.value === null) return 'غير متاح'
  if (metric.unit === 'percent') return `${metric.value.toFixed(1)}%`
  if (metric.unit === 'count') return formatNumber(metric.value)
  if (metric.unit === 'ratio') return `${metric.value.toFixed(2)}×`
  return formatCurrency(metric.value)
}

function metricLine(metric: Metric | undefined): string | null {
  if (!metric) return null
  return `• ${metric.label}: ${formatMetric(metric)}`
}

function collectEvidence(overview: BusinessOverview, keys: string[]): AgentAnswer['evidence']['metrics'] {
  const rows: AgentAnswer['evidence']['metrics'] = []
  for (const key of keys) {
    const metric = overview.byKey[key]
    if (!metric) continue
    rows.push({
      key: metric.key,
      label: metric.label,
      value: metric.value,
      unit: metric.unit,
      status: metric.provenance.status,
    })
  }
  return rows
}

/**
 * Build the answer for a question that names TWO periods.
 *
 * The two periods are compared as named. The engine's automatic
 * "previous equal-length window" is a different thing — "last month" is not
 * "the 30 days before the 21st of this month" — so it is never presented as
 * if it were.
 */
export function buildComparisonAnswer(
  current: BusinessOverview,
  previous: BusinessOverview,
  toolEvidence: ToolEvidence
): AgentAnswer {
  const currentLabel = current.window.label
  const previousLabel = previous.window.label

  const keys = [
    'revenue',
    'total_orders',
    'average_order_value',
    'net_profit',
    'product_costs',
    'operating_expenses',
  ]

  const rows: string[] = []
  const metricRows: AgentAnswer['evidence']['metrics'] = []

  for (const key of keys) {
    const a = current.byKey[key]
    const b = previous.byKey[key]
    if (!a) continue

    if (a.value === null || b?.value === null || b === undefined) {
      rows.push(`• ${a.label}: محجوب في الفترة الأولى أو الثانية`)
      metricRows.push({
        key: a.key,
        label: a.label,
        value: a.value,
        unit: a.unit,
        status: a.provenance.status,
      })
      continue
    }

    const diff = a.value - b.value
    const percent = b.value === 0 ? null : (diff / Math.abs(b.value)) * 100
    const direction = diff > 0 ? 'أعلى' : diff < 0 ? 'أقل' : 'بدون تغيير'
    rows.push(
      `• ${a.label}: ${formatMetric(a)} مقابل ${formatMetric(b)} — ${direction}${percent !== null ? ` ${Math.abs(percent).toFixed(1)}%` : ''}`
    )
    metricRows.push({
      key: a.key,
      label: a.label,
      value: a.value,
      unit: a.unit,
      status: a.provenance.status,
    })
  }

  return {
    text: [`مقارنة ${currentLabel} مع ${previousLabel}:`, ...rows].join('\n'),
    status: 'answered',
    evidence: {
      calculation: toolEvidence.calculation,
      sources: toolEvidence.sources,
      missing: toolEvidence.missing,
      metrics: metricRows,
    },
    followUps: [],
    tool: 'get_business_overview',
  }
}

/**
 * Build the answer for a detected intent.
 *
 * `toolResult.data` is the raw tool output; for the overview tool it is a
 * `BusinessOverview`.
 */
export function buildDeterministicAnswer(
  intent: AgentIntent,
  toolResult: ToolResult,
  periodLabel?: string
): AgentAnswer {
  if (!toolResult.ok) {
    return {
      text: `تعذّر جلب البيانات: ${toolResult.error ?? 'خطأ غير معروف'}.`,
      status: 'unable_to_retrieve',
      evidence: { calculation: '', sources: [], missing: [], metrics: [] },
      followUps: ['تحقّق من حالة الاتصال بقاعدة البيانات'],
      tool: 'unknown',
    }
  }

  const data = toolResult.data as BusinessOverview | null
  // The window label comes from the TOOL, not from the caller: the tool ran
  // the real query, so its label is the one that describes the numbers.
  const period = toolResult.evidence.window?.label
    ? ` (${toolResult.evidence.window.label})`
    : periodLabel
      ? ` (${periodLabel})`
      : ''

  // ── The Brain ────────────────────────────────────────────────────────
  if (intent === 'brain_status') {
    const report = toolResult.data as {
      available?: boolean
      statusLabel?: string
      coverage?: number
      answered?: number
      answerable?: number
      gaps?: { label: string }[]
    } | null

    if (!report || report.available === false) {
      return {
        text: 'عقل النشاط غير مُعد بعد — لم يتم تطبيق جداول Business Brain على قاعدة البيانات، لذلك لا توجد معرفة مسجّلة.',
        status: 'insufficient_data',
        evidence: { ...toolResult.evidence, metrics: [] },
        followUps: ['شغّل migration 20260123000000_business_brain.sql', 'أجب عن الأسئلة في صفحة "عقل النشاط"'],
        tool: 'get_brain_status',
      }
    }

    const gapLines = (report.gaps ?? []).slice(0, 5).map(g => `• ${g.label}`)
    return {
      text: [
        `حالة عقل النشاط: ${report.statusLabel ?? '—'}.`,
        `التغطية ${report.coverage ?? 0}% (${report.answered ?? 0} من ${report.answerable ?? 0} سؤالاً واجباً).`,
        gapLines.length ? 'ما ينقص:' : 'لا يوجد ما ينقص.',
        ...gapLines,
      ].join('\n'),
      status: 'answered',
      evidence: { ...toolResult.evidence, metrics: [] },
      followUps: ['افتح صفحة "عقل النشاط" للإجابة على الأسئلة المفتوحة'],
      tool: 'get_brain_status',
    }
  }

  // ── The decisions ─────────────────────────────────────────────────────
  if (intent === 'decisions') {
    const result = toolResult.data as {
      decisions?: {
        severity: string
        title: string
        why: string
        action: { label: string; href?: string }
        evidence: { label: string; value: string }[]
      }[]
      window?: { label: string }
    } | null

    const decisions = result?.decisions ?? []
    if (decisions.length === 0) {
      return {
        text: `لا توجد قرارات مفتوحة${period} — البيانات المتاحة لا تُظهر مشكلة تحتاج تدخلاً الآن.`,
        status: 'answered',
        evidence: { ...toolResult.evidence, metrics: [] },
        followUps: [],
        tool: 'get_decisions',
      }
    }

    const severityLabel: Record<string, string> = {
      critical: 'حرج',
      high: 'عالٍ',
      medium: 'متوسط',
      low: 'منخفض',
      info: 'معلومة',
    }

    const lines = decisions.slice(0, 6).map(d => {
      const evidence = d.evidence
        .slice(0, 2)
        .map(e => `${e.label}: ${e.value}`)
        .join(' · ')
      return `• [${severityLabel[d.severity] ?? d.severity}] ${d.title}\n  ${d.why}\n  الدليل: ${evidence}`
    })

    return {
      text: [
        `أهم ما يحتاج قرارك${period} (${decisions.length} قرار):`,
        ...lines,
      ].join('\n'),
      status: 'answered',
      evidence: { ...toolResult.evidence, metrics: [] },
      followUps: decisions
        .slice(0, 3)
        .map(d => d.action.href)
        .filter((href): href is string => Boolean(href)),
      tool: 'get_decisions',
    }
  }

  if (!data || !data.byKey) {
    return {
      text: 'لم أستطع إجابة هذا السؤال لأن البيانات المطلوبة غير متاحة.',
      status: 'insufficient_data',
      evidence: { ...toolResult.evidence, metrics: [] },
      followUps: ['جرّب سؤالاً عن المبيعات أو الطلبات أو النقد'],
      tool: 'unknown',
    }
  }

  const overview = data

  switch (intent) {
    case 'sales_total': {
      const revenue = overview.byKey.revenue
      const orders = overview.byKey.total_orders
      const change = revenue?.changePercent
      const lines = [
        metricLine(revenue) ?? '• المبيعات: غير متاح',
        metricLine(orders) ?? null,
        change !== null && change !== undefined
          ? `• مقارنة بالفترة السابقة: ${change > 0 ? 'أعلى' : 'أقل'} ${Math.abs(change).toFixed(1)}%`
          : null,
      ].filter(Boolean) as string[]
      return {
        text: `المبيعات${period}:\n${lines.join('\n')}`,
        status: revenue?.value === null ? 'insufficient_data' : 'answered',
        evidence: {
          ...toolResult.evidence,
          metrics: collectEvidence(overview, ['revenue', 'total_orders', 'average_order_value']),
        },
        followUps: overview.gaps.slice(0, 2).map(g => g.title),
        tool: 'get_business_overview',
      }
    }

    case 'profit': {
      const net = overview.byKey.net_profit
      const fallback = overview.byKey.revenue_minus_expenses
      const costs = overview.byKey.product_costs
      const ads = overview.byKey.advertising_spend

      if (net?.value !== null && net?.value !== undefined) {
        return {
          text: `صافي الربح${period}: ${formatMetric(net)}\n${net.provenance.calculation}`,
          status: 'answered',
          evidence: {
            ...toolResult.evidence,
            metrics: collectEvidence(overview, ['net_profit', 'revenue', 'product_costs', 'advertising_spend']),
          },
          followUps: [],
          tool: 'get_business_overview',
        }
      }

      const missing = net?.provenance.missing ?? []
      const lines = [
        `صافي الربح${period} محجوب — ليس رقماً صحيحاً أن أعرضه الآن.`,
        `السبب: ${missing.join(' • ') || 'مدخلات ناقصة'}.`,
        fallback?.value !== null && fallback?.value !== undefined
          ? `الرقم المتاح الآن: ${fallback.label} = ${formatMetric(fallback)}.`
          : 'لا يوجد حتى رقم بديل صادق: المصروفات نفسها غير مسجّلة.',
        costs?.value === null ? 'تكلفة المنتجات غير مسجّلة — أدخلها لتظهر الأرباح.' : null,
        ads?.value === null ? 'لا يوجد اتصال إعلاني — إنفاق الإعلانات غير مرئي.' : null,
      ].filter(Boolean) as string[]

      return {
        text: lines.join('\n'),
        status: 'calculation_unavailable',
        evidence: {
          ...toolResult.evidence,
          metrics: collectEvidence(overview, ['net_profit', 'revenue_minus_expenses', 'product_costs', 'advertising_spend', 'operating_expenses']),
        },
        followUps: [
          'سجّل تكلفة كل منتج من صفحة المنتجات',
          'اربط منصة الإعلانات من صفحة الإعدادات',
          'ابدأ بتسجيل المصروفات اليومية',
        ],
        tool: 'get_business_overview',
      }
    }

    case 'cash_with_couriers': {
      const metric = overview.byKey.cash_held_by_couriers
      return {
        text:
          metric?.value === null || metric?.value === undefined
            ? `النقد المحتجز لدى شركات الشحن غير معروف${period}: ${metric?.provenance.missing[0] ?? 'لا توجد بيانات تحصيل'}.`
            : `النقد المحتجز لدى شركات الشحن${period}: ${formatMetric(metric)} (${metric.provenance.calculation}).`,
        status: metric?.value === null ? 'insufficient_data' : 'answered',
        evidence: { ...toolResult.evidence, metrics: collectEvidence(overview, ['cash_held_by_couriers', 'cash_collected']) },
        followUps: metric?.value === null ? ['سجّل أول دفعة تحصيل من صفحة "مطابقة التحصيل"'] : [],
        tool: 'get_business_overview',
      }
    }

    case 'cash_collected': {
      const metric = overview.byKey.cash_collected
      return {
        text:
          metric?.value === null || metric?.value === undefined
            ? `النقد المحصّل غير معروف${period}: ${metric?.provenance.missing[0] ?? 'لا توجد بيانات تحصيل'}.`
            : `النقد المحصّل فعلياً${period}: ${formatMetric(metric)}.`,
        status: metric?.value === null ? 'insufficient_data' : 'answered',
        evidence: { ...toolResult.evidence, metrics: collectEvidence(overview, ['cash_collected', 'cash_held_by_couriers']) },
        followUps: [],
        tool: 'get_business_overview',
      }
    }

    case 'shipping_cost': {
      const metric = overview.byKey.shipping_cost
      return {
        text:
          metric?.value === null || metric?.value === undefined
            ? `تكلفة الشحن غير معروفة${period}.`
            : `تكلفة الشحن${period}: ${formatMetric(metric)} — ${metric.provenance.calculation}.`,
        status: metric?.value === null ? 'insufficient_data' : 'answered',
        evidence: { ...toolResult.evidence, metrics: collectEvidence(overview, ['shipping_cost', 'total_orders']) },
        followUps:
          metric?.provenance.status === 'estimated'
            ? ['التكلفة تقديرية من السعر الثابت — سجّل تحصيلات الشحن لتصبح فعلية']
            : [],
        tool: 'get_business_overview',
      }
    }

    case 'inventory': {
      const units = overview.byKey.inventory_units
      const value = overview.byKey.inventory_value
      return {
        text: [
          `المخزون${period}:`,
          metricLine(units) ?? null,
          metricLine(value) ?? null,
          value?.value === null ? value.provenance.missing.join(' • ') : null,
        ]
          .filter(Boolean)
          .join('\n'),
        status: value?.value === null ? 'insufficient_data' : 'answered',
        evidence: { ...toolResult.evidence, metrics: collectEvidence(overview, ['inventory_units', 'inventory_value']) },
        followUps: [],
        tool: 'get_business_overview',
      }
    }

    case 'product_performance':
    case 'losing_products': {
      const list = intent === 'losing_products' ? overview.losingProducts : overview.topProducts
      if (list.length === 0) {
        return {
          text:
            intent === 'losing_products'
              ? 'لا توجد منتجات بهامش سالب في هذه الفترة — أو لا توجد تكلفة مسجّلة تكفي للحساب.'
              : 'لا توجد مبيعات منتجات في هذه الفترة.',
          status: 'insufficient_data',
          evidence: { ...toolResult.evidence, metrics: [] },
          followUps: ['سجّل تكلفة المنتجات لتظهر الهوامش'],
          tool: 'get_business_overview',
        }
      }

      const rows = list.slice(0, 8).map(p => {
        const margin = p.margin === null ? 'الهامش غير معروف (التكلفة غير مسجّلة)' : `الهامش ${formatCurrency(p.margin)}`
        return `• ${p.name}: ${formatNumber(p.units)} قطعة · ${formatCurrency(p.revenue)} · ${margin}`
      })

      return {
        text: [
          intent === 'losing_products' ? `المنتجات الخاسرة${period}:` : `أفضل المنتجات${period}:`,
          ...rows,
        ].join('\n'),
        status: 'answered',
        evidence: { ...toolResult.evidence, metrics: [] },
        followUps: [],
        tool: 'get_business_overview',
      }
    }

    case 'order_value': {
      const metric = overview.byKey.average_order_value
      return {
        text:
          metric?.value === null || metric?.value === undefined
            ? `متوسط قيمة الطلب غير متاح${period}.`
            : `متوسط قيمة الطلب${period}: ${formatMetric(metric)} (${metric.provenance.calculation}).`,
        status: metric?.value === null ? 'insufficient_data' : 'answered',
        evidence: { ...toolResult.evidence, metrics: collectEvidence(overview, ['average_order_value', 'revenue', 'total_orders']) },
        followUps: [],
        tool: 'get_business_overview',
      }
    }

    case 'orders_count': {
      const orders = overview.byKey.total_orders
      const pending = overview.byKey.pending_orders
      const shipped = overview.byKey.shipped_orders
      const delivered = overview.byKey.delivered_orders
      return {
        text: [
          `الطلبات${period}: ${formatMetric(orders ?? ({ value: null } as unknown as Metric))}`,
          `• قيد الانتظار: ${formatMetric(pending as Metric)}`,
          `• مُسلَّمة: ${formatMetric(shipped as Metric)}`,
          `• تم تسليمها للعميل: ${formatMetric(delivered as Metric)}`,
        ].join('\n'),
        status: orders?.value === null ? 'insufficient_data' : 'answered',
        evidence: {
          ...toolResult.evidence,
          metrics: collectEvidence(overview, ['total_orders', 'pending_orders', 'shipped_orders', 'delivered_orders', 'cancelled_orders', 'returned_orders']),
        },
        followUps: [],
        tool: 'get_business_overview',
      }
    }

    case 'compare_periods': {
      const withChange = overview.metrics.filter(m => m.changePercent !== null && m.changePercent !== undefined)
      if (withChange.length === 0) {
        return {
          text: 'لا توجد مقارنة متاحة — الفترة السابقة غير محددة أو لا توجد بيانات فيها.',
          status: 'insufficient_data',
          evidence: { ...toolResult.evidence, metrics: [] },
          followUps: [],
          tool: 'get_business_overview',
        }
      }
      const rows = withChange.slice(0, 8).map(m => {
        const change = m.changePercent as number
        return `• ${m.label}: ${formatMetric(m)} (${change > 0 ? '+' : ''}${change.toFixed(1)}% عن الفترة السابقة)`
      })
      return {
        text: [`مقارنة مع الفترة السابقة${period}:`, ...rows].join('\n'),
        status: 'answered',
        evidence: { ...toolResult.evidence, metrics: collectEvidence(overview, withChange.map(m => m.key)) },
        followUps: [],
        tool: 'get_business_overview',
      }
    }

    case 'data_gaps': {
      const gaps = overview.gaps
      if (gaps.length === 0) {
        return {
          text: 'لا توجد فجوات بيانات معروفة في هذه الفترة.',
          status: 'answered',
          evidence: { ...toolResult.evidence, metrics: [] },
          followUps: [],
          tool: 'get_business_overview',
        }
      }
      const rows = gaps.map(g => `• [${g.severity}] ${g.title} — ${g.detail}`)
      return {
        text: [`ما ينقص من البيانات${period}:`, ...rows].join('\n'),
        status: 'answered',
        evidence: { ...toolResult.evidence, metrics: [] },
        followUps: gaps.filter(g => g.actionHref).map(g => g.actionHref as string),
        tool: 'get_business_overview',
      }
    }

    default: {
      const revenue = overview.byKey.revenue
      const orders = overview.byKey.total_orders
      return {
        text: [
          `لم أفهم السؤال تماماً، وهذه أرقام الفترة${period}:`,
          metricLine(revenue) ?? null,
          metricLine(orders) ?? null,
          'اسأل مثلاً: "كم مبيعات آخر 30 يوم؟" أو "كم نقداً عند شركات الشحن؟"',
        ]
          .filter(Boolean)
          .join('\n'),
        status: 'partially_answered',
        evidence: { ...toolResult.evidence, metrics: collectEvidence(overview, ['revenue', 'total_orders']) },
        followUps: ['كم مبيعات آخر 30 يوم؟', 'كم نقداً عند شركات الشحن؟', 'ما الذي ينقص من البيانات؟'],
        tool: 'get_business_overview',
      }
    }
  }
}
