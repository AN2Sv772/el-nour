/**
 * The agent's tools — the ONLY way the assistant is allowed to produce a
 * number.
 *
 * Every tool reads the real database through the same engines the dashboard
 * uses, and returns the evidence it used. If a tool cannot compute something,
 * it says so; it never fills the gap with a plausible guess.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildBusinessOverview } from '@/lib/metrics/engine'
import { computeBrainStatus, readBrainRows } from '@/lib/brain/status'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { resolveDateRange } from '@/lib/date-range'
import { buildDecisions } from '@/lib/decisions/engine'

export interface ToolEvidence {
  /** The tables / sources the answer was computed from. */
  sources: string[]
  /** The formula, in plain words. */
  calculation: string
  /** What could NOT be computed, and why. */
  missing: string[]
  /** The window the numbers refer to. */
  window?: { from: string | null; to: string | null; label: string }
}

export interface ToolResult<T = unknown> {
  ok: boolean
  data: T | null
  evidence: ToolEvidence
  error?: string
}

export interface ToolDefinition {
  name: string
  description: string
  /** The questions this tool answers (used by the deterministic router). */
  intents: string[]
  execute: (
    db: SupabaseClient,
    args: { dateRange?: string | null; from?: string | null; to?: string | null }
  ) => Promise<ToolResult>
}

const EMPTY_EVIDENCE: ToolEvidence = { sources: [], calculation: '', missing: [] }

function ok<T>(data: T, evidence: ToolEvidence): ToolResult<T> {
  return { ok: true, data, evidence }
}

function fail(error: string): ToolResult<never> {
  return { ok: false, data: null, evidence: EMPTY_EVIDENCE, error }
}

/* ── Tool implementations ─────────────────────────────────────────────── */

async function overviewTool(
  db: SupabaseClient,
  args: { dateRange?: string | null; from?: string | null; to?: string | null }
): Promise<ToolResult> {
  try {
    const overview = await buildBusinessOverview(db, {
      dateRange: args.dateRange,
      from: args.from,
      to: args.to,
    })

    const missing: string[] = []
    for (const metric of overview.metrics) {
      if (metric.provenance.status !== 'actual' && metric.provenance.status !== 'estimated') {
        missing.push(...metric.provenance.missing)
      }
    }

    return ok(overview, {
      sources: ['orders', 'order_items', 'products', 'expenses', 'collection_batches', 'daily_reconciliations'],
      calculation: 'محرك المقاييس الموحّد — نفس الحساب المستخدم في لوحة التحكم',
      missing: [...new Set(missing)],
      window: { from: overview.window.from, to: overview.window.to, label: overview.window.label },
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Failed to read the metrics')
  }
}

async function brainTool(db: SupabaseClient): Promise<ToolResult> {
  try {
    const rows = await readBrainRows(db)
    if (!rows) {
      return ok(
        { available: false },
        {
          sources: ['business_profile', 'business_knowledge', 'business_brain_questions'],
          calculation: 'قراءة حالة عقل النشاط',
          missing: ['جداول Business Brain غير مطبَّقة على قاعدة البيانات بعد'],
        }
      )
    }
    const report = computeBrainStatus({
      profile: rows.profile,
      questions: rows.questions,
      knowledge: rows.knowledge,
      lastRun: rows.lastRun,
    })
    return ok(report, {
      sources: ['business_profile', 'business_knowledge', 'business_brain_questions', 'business_brain_runs'],
      calculation: 'التغطية = الأسئلة الواجبة المُجاب عنها ÷ الأسئلة الواجبة',
      missing: report.gaps.map(g => g.label),
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Failed to read the Brain status')
  }
}

async function orderStatusTool(
  db: SupabaseClient,
  args: { dateRange?: string | null; from?: string | null; to?: string | null }
): Promise<ToolResult> {
  try {
    const range = resolveDateRange({ dateRange: args.dateRange, from: args.from, to: args.to })
    const rows = await fetchAllRows<{ status: string; total_amount: number | null; created_at: string }>(
      (f, t) =>
        db
          .from('orders')
          .select('status, total_amount, created_at')
          .gte('created_at', range.from ?? '1900-01-01')
          .lte('created_at', range.to ?? '2999-12-31')
          .order('id', { ascending: true })
          .range(f, t),
      1000
    )

    const byStatus: Record<string, { count: number; value: number }> = {}
    for (const row of rows) {
      const entry = byStatus[row.status] ?? { count: 0, value: 0 }
      entry.count += 1
      entry.value += Number(row.total_amount ?? 0)
      byStatus[row.status] = entry
    }

    return ok({ byStatus, total: rows.length }, {
      sources: ['orders'],
      calculation: 'تجميع الطلبات حسب الحالة',
      missing: [],
      window: { from: range.from, to: range.to, label: range.label },
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Failed to read the orders')
  }
}

async function reconciliationTool(db: SupabaseClient): Promise<ToolResult> {
  try {
    const rows = await fetchAllRows<{
      business_date: string
      orders_count: number
      returned_orders_count: number
      reconciled_profit: number
    }>((f, t) =>
      db
        .from('daily_reconciliations')
        .select('business_date, orders_count, returned_orders_count, reconciled_profit')
        .order('business_date', { ascending: false })
        .range(f, t)
    )

    return ok({ rows }, {
      sources: ['daily_reconciliations'],
      calculation: 'قراءة التسويات اليومية المسجّلة',
      missing: rows.length === 0 ? ['لا توجد تسويات يومية مسجّلة'] : [],
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Failed to read the reconciliations')
  }
}

async function decisionsTool(
  db: SupabaseClient,
  args: { dateRange?: string | null; from?: string | null; to?: string | null }
): Promise<ToolResult> {
  try {
    const result = await buildDecisions(db, {
      dateRange: args.dateRange,
      from: args.from,
      to: args.to,
    })
    return ok(result, {
      sources: ['orders', 'products', 'order_items', 'expenses', 'collection_batches', 'daily_reconciliations', 'business_settings'],
      calculation: 'قواعد حتمية على بيانات حقيقية — كل قرار يذكر أرقامه ومصادره',
      missing: result.decisions.filter(d => d.impact === null).map(d => d.title),
      window: { from: result.window.from, to: result.window.to, label: result.window.label },
    })
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Failed to read the decisions')
  }
}

/* ── The registry ──────────────────────────────────────────────────────── */

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'get_business_overview',
    description: 'The executive metric set for a period — revenue, orders, profit (or why it is withheld), cash, shipping, inventory.',
    intents: ['sales_total', 'profit', 'orders_count', 'order_value', 'cash_with_couriers', 'cash_collected', 'shipping_cost', 'inventory', 'compare_periods'],
    execute: overviewTool,
  },
  {
    name: 'get_product_performance',
    description: 'Product-level revenue, units, cost and margin for a period.',
    intents: ['product_performance', 'losing_products'],
    execute: overviewTool,
  },
  {
    name: 'get_brain_status',
    description: 'What the business brain knows: coverage, gaps, outdated knowledge.',
    intents: ['brain_status'],
    execute: brainTool,
  },
  {
    name: 'get_data_gaps',
    description: 'What is missing from the data — the reasons numbers are withheld.',
    intents: ['data_gaps'],
    execute: overviewTool,
  },
  {
    name: 'get_order_status_breakdown',
    description: 'Orders grouped by status with their value.',
    intents: ['orders_count'],
    execute: orderStatusTool,
  },
  {
    name: 'get_decisions',
    description: 'The decisions the business owner should act on, each with its evidence and the action that resolves it.',
    intents: ['decisions'],
    execute: decisionsTool,
  },
  {
    name: 'get_reconciliation_status',
    description: 'The daily reconciliations recorded, with returned orders and reconciled profit.',
    intents: ['profit'],
    execute: reconciliationTool,
  },
]

/**
 * The intent → tool map.
 *
 * The FIRST tool that claims an intent wins: `get_business_overview` is the
 * general-purpose engine and is registered before the specialised tools, so
 * "ما هو صافي الربح؟" is answered by the metrics engine (which knows why the
 * profit is withheld) rather than by the reconciliation reader.
 */
export const TOOL_BY_INTENT = new Map<string, ToolDefinition>()
for (const tool of AGENT_TOOLS) {
  for (const intent of tool.intents) {
    if (!TOOL_BY_INTENT.has(intent)) TOOL_BY_INTENT.set(intent, tool)
  }
}

export function findToolForIntent(intent: string): ToolDefinition | null {
  return TOOL_BY_INTENT.get(intent) ?? null
}
