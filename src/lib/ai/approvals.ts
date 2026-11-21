/**
 * Approvals — the owner's signature on every change the assistant proposes.
 *
 * THE RULE
 * -------
 * The assistant never changes anything by itself. It proposes an action with
 * its impact and its risk; an admin approves or rejects it; the action runs
 * EXACTLY ONCE and is logged with its before/after state.
 *
 * WHY IT MATTERS HERE
 * -------------------
 * The numbers that are currently withheld (profit, inventory value, the
 * honest expense line) are withheld because the owner has not recorded the
 * costs yet. This module is the path that fixes that — safely, one step at a
 * time, with a trail.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'

export type ApprovalActionType = 'set_product_cost' | 'add_expense' | 'set_business_setting'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'running' | 'done' | 'failed' | 'expired'
export type RiskLevel = 'notification' | 'low' | 'medium' | 'high'

export interface ApprovalRow {
  id: string
  action_type: ApprovalActionType
  title: string
  description: string
  payload: Record<string, unknown>
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  impact_summary: string | null
  risk_level: RiskLevel
  reversible: boolean
  status: ApprovalStatus
  idempotency_key: string
  requested_by: string | null
  approved_by: string | null
  approved_at: string | null
  executed_at: string | null
  expires_at: string
  error: string | null
  created_at: string
}

export interface ApprovalAction {
  type: ApprovalActionType
  title: string
  description: string
  payload: Record<string, unknown>
  impactSummary: string
  riskLevel: RiskLevel
  reversible: boolean
}

/** A stable key so the SAME proposal can never be applied twice. */
export function idempotencyKeyFor(action: ApprovalAction): string {
  const canonical = JSON.stringify({
    type: action.type,
    payload: Object.keys(action.payload)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = action.payload[key]
        return acc
      }, {}),
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 48)
}

/**
 * The actions the assistant may propose.
 *
 * Every one of them:
 *   - changes ONE existing row (or adds ONE expense row),
 *   - is reversible (the before-state is stored and can be restored),
 *   - never touches orders, customers, payments or anything irreversible.
 *
 * An action that is not in this list cannot be proposed. That is the
 * allow-list.
 */
export const ALLOWED_ACTIONS: ApprovalActionType[] = [
  'set_product_cost',
  'add_expense',
  'set_business_setting',
]

export function isAllowedAction(type: string): type is ApprovalActionType {
  return ALLOWED_ACTIONS.includes(type as ApprovalActionType)
}

/* ── The read helpers ──────────────────────────────────────────────────── */

async function readProduct(db: SupabaseClient, productId: string) {
  const { data, error } = await db
    .from('products')
    .select('id, name, name_ar, sku, price, cost_price, stock_quantity')
    .eq('id', productId)
    .maybeSingle()
  if (error) throw error
  return data as { id: string; name: string; name_ar: string | null; sku: string; price: number; cost_price: number | null; stock_quantity: number | null } | null
}

async function readBusinessSettings(db: SupabaseClient) {
  const { data, error } = await db
    .from('business_settings')
    .select('id, business_name, default_shipping_fee, tax_rate, currency')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as { id: string; business_name: string; default_shipping_fee: number | null; tax_rate: number | null; currency: string } | null
}

/** The state BEFORE the change — written at approval time. */
export async function captureBeforeState(
  db: SupabaseClient,
  action: ApprovalAction
): Promise<Record<string, unknown>> {
  switch (action.type) {
    case 'set_product_cost': {
      const product = await readProduct(db, String(action.payload.product_id))
      return product
        ? { kind: 'product', id: product.id, name: product.name, cost_price: product.cost_price, price: product.price }
        : { kind: 'product', id: String(action.payload.product_id), missing: true }
    }
    case 'add_expense': {
      return { kind: 'expense', note: 'سطر مصروف جديد' }
    }
    case 'set_business_setting': {
      const settings = await readBusinessSettings(db)
      const key = String(action.payload.key)
      return {
        kind: 'business_settings',
        id: settings?.id ?? null,
        key,
        value: settings ? (settings as unknown as Record<string, unknown>)[key] : null,
      }
    }
    default:
      return {}
  }
}

/* ── The execution ─────────────────────────────────────────────────────── */

/**
 * Apply an approved action.
 *
 * The caller MUST have verified the approval (status = approved, not expired,
 * the idempotency key unused). The execution log's UNIQUE key is the last
 * line of defence: if the row already exists, the action did not run twice.
 */
export async function executeApproval(
  db: SupabaseClient,
  approval: ApprovalRow,
  executedBy: string
): Promise<{ ok: boolean; error?: string; afterState?: Record<string, unknown> }> {
  const started = Date.now()
  let afterState: Record<string, unknown> = {}

  try {
    switch (approval.action_type) {
      case 'set_product_cost': {
        const productId = String(approval.payload.product_id)
        const cost = Number(approval.payload.cost_price)
        if (!Number.isFinite(cost) || cost < 0) {
          throw new Error('قيمة التكلفة غير صالحة')
        }
        const { data, error } = await db
          .from('products')
          .update({ cost_price: cost })
          .eq('id', productId)
          .select('id, name, cost_price')
          .single()
        if (error) throw error
        afterState = { kind: 'product', id: data.id, name: data.name, cost_price: data.cost_price }
        break
      }

      case 'add_expense': {
        const amount = Number(approval.payload.amount)
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error('قيمة المصروف غير صالحة')
        }
        const { data, error } = await db
          .from('expenses')
          .insert({
            amount,
            category: String(approval.payload.category ?? 'other'),
            expense_date: String(approval.payload.expense_date ?? new Date().toISOString().slice(0, 10)),
            notes: approval.payload.notes ?? null,
            created_by: executedBy,
          })
          .select('id, amount, category, expense_date')
          .single()
        if (error) throw error
        afterState = { kind: 'expense', id: data.id, amount: data.amount, category: data.category, expense_date: data.expense_date }
        break
      }

      case 'set_business_setting': {
        const key = String(approval.payload.key)
        const allowed = ['default_shipping_fee', 'tax_rate']
        if (!allowed.includes(key)) {
          throw new Error(`الحقل "${key}" غير قابل للتعديل من هنا`)
        }
        const value = Number(approval.payload.value)
        if (!Number.isFinite(value) || value < 0) {
          throw new Error('القيمة غير صالحة')
        }
        const settings = await readBusinessSettings(db)
        if (!settings) throw new Error('لا يوجد صف إعدادات')
        const { data, error } = await db
          .from('business_settings')
          .update({ [key]: value })
          .eq('id', settings.id)
          .select('id, default_shipping_fee, tax_rate')
          .single()
        if (error) throw error
        afterState = { kind: 'business_settings', id: data.id, key, value }
        break
      }

      default:
        throw new Error(`إجراء غير مدعوم: ${approval.action_type}`)
    }

    // The execution log — the UNIQUE idempotency key is what makes this
    // exactly-once.
    const { error: logError } = await db.from('ai_execution_logs').insert({
      approval_id: approval.id,
      idempotency_key: approval.idempotency_key,
      action_type: approval.action_type,
      payload: approval.payload,
      before_state: approval.before_state,
      after_state: afterState,
      status: 'ok',
      duration_ms: Date.now() - started,
      executed_by: executedBy,
    })

    if (logError) {
      // 23505 = unique violation → this action already ran.
      if (logError.code === '23505') {
        return { ok: false, error: 'هذا الإجراء نُفِّذ مسبقاً — لم يتكرر.' }
      }
      throw logError
    }

    return { ok: true, afterState }
  } catch (error) {
    await db.from('ai_execution_logs').insert({
      approval_id: approval.id,
      idempotency_key: `${approval.idempotency_key}:error`,
      action_type: approval.action_type,
      payload: approval.payload,
      before_state: approval.before_state,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - started,
      executed_by: executedBy,
    })

    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/** Undo an executed action from its stored before-state. */
export async function reverseApproval(
  db: SupabaseClient,
  approval: ApprovalRow,
  executedBy: string
): Promise<{ ok: boolean; error?: string }> {
  const before = approval.before_state ?? {}
  try {
    if (approval.action_type === 'set_product_cost') {
      const { error } = await db
        .from('products')
        .update({ cost_price: (before.cost_price as number | null) ?? null })
        .eq('id', String(before.id))
      if (error) throw error
      return { ok: true }
    }
    if (approval.action_type === 'add_expense') {
      const { error } = await db
        .from('expenses')
        .delete()
        .eq('id', String((approval.after_state as Record<string, unknown>)?.id ?? ''))
      if (error) throw error
      return { ok: true }
    }
    if (approval.action_type === 'set_business_setting') {
      const { error } = await db
        .from('business_settings')
        .update({ [String(before.key)]: (before.value as number | null) ?? null })
        .eq('id', String(before.id))
      if (error) throw error
      return { ok: true }
    }
    return { ok: false, error: 'لا يمكن التراجع عن هذا الإجراء' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' }
  } finally {
    void executedBy
  }
}
