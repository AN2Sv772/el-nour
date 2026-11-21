/**
 * Turning a request into a PROPOSAL.
 *
 * The assistant never changes anything by itself. When the owner asks for a
 * change ("سجّل تكلفة المنتج ده بـ 45 جنيه"), the assistant turns that into
 * a proposal with its impact, and waits for the owner's approval.
 *
 * The parser is deliberately narrow: it only understands the three actions
 * in the allow-list, and it refuses to guess. If it cannot find the product
 * or the amount, it says so instead of proposing something wrong.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { normalizeArabic } from './intent'
import type { ApprovalAction, ApprovalActionType } from './approvals'

/** Arabic-Indic digits → Latin. */
export function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
}

/**
 * Extract a money amount from an Arabic sentence.
 *
 * Handles "45 جنيه", "45.5 جنيه", "بـ 120" and "45 EGP".
 */
export function parseAmount(text: string): number | null {
  const normalized = normalizeDigits(text)
  const match = normalized.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:جنيه|ج\.?م|egy|egp|ريال)?/i)
  if (!match) return null
  const value = Number(match[1].replace(',', '.'))
  return Number.isFinite(value) && value >= 0 ? value : null
}

export interface ProductOption {
  id: string
  name: string
  name_ar: string | null
  sku: string
  price: number
  cost_price: number | null
}

export async function listProductOptions(db: SupabaseClient): Promise<ProductOption[]> {
  return fetchAllRows<ProductOption>((f, t) =>
    db
      .from('products')
      .select('id, name, name_ar, sku, price, cost_price')
      .order('id', { ascending: true })
      .range(f, t)
  )
}

/**
 * Find the product the sentence is about.
 *
 * It matches on the SKU first (unambiguous), then on the product name — the
 * LONGEST matching name wins, so "مساحة ارضيات ببخاخ" beats "مساحة ارضيات".
 */
export function matchProduct(question: string, products: ProductOption[]): ProductOption | null {
  const normalized = normalizeArabic(normalizeDigits(question))

  for (const product of products) {
    if (product.sku && normalized.includes(normalizeArabic(product.sku))) {
      return product
    }
  }

  let best: { product: ProductOption; length: number } | null = null
  for (const product of products) {
    for (const candidate of [product.name, product.name_ar].filter(Boolean) as string[]) {
      const needle = normalizeArabic(candidate)
      if (needle.length < 3) continue
      if (!normalized.includes(needle)) continue
      if (!best || needle.length > best.length) {
        best = { product, length: needle.length }
      }
    }
  }

  return best?.product ?? null
}

export type ActionRequest =
  | { kind: 'set_product_cost'; product: ProductOption; cost: number }
  | { kind: 'add_expense'; amount: number; category: string; notes: string }
  | { kind: 'set_business_setting'; key: string; value: number }

const COST_MARKERS = ['سجل تكلفه', 'سجّل تكلفه', 'تكلفه المنتج', 'سعر التكلفه', 'اكتب تكلفه', 'غير تكلفه']
const EXPENSE_MARKERS = ['سجل مصروف', 'سجّل مصروف', 'اضف مصروف', 'أضف مصروف', 'مصروف جديد', 'سجل مبلغ']
const SHIPPING_MARKERS = ['سعر الشحن', 'رسوم الشحن', 'تكلفه الشحن', ' shipping fee']

/**
 * Detect the requested change.
 *
 * Returns null when the sentence is not a change request — the question
 * path then answers it as a question.
 */
export async function detectActionRequest(
  db: SupabaseClient,
  question: string
): Promise<ApprovalAction | null> {
  const normalized = normalizeArabic(normalizeDigits(question))

  const isCost = COST_MARKERS.some(m => normalized.includes(normalizeArabic(m)))
  const isExpense = EXPENSE_MARKERS.some(m => normalized.includes(normalizeArabic(m)))
  const isShipping = SHIPPING_MARKERS.some(m => normalized.includes(normalizeArabic(m)))

  if (!isCost && !isExpense && !isShipping) return null

  if (isShipping) {
    const value = parseAmount(question)
    if (value === null) return null
    return {
      type: 'set_business_setting',
      title: 'تعديل سعر الشحن الثابت',
      description: `ضبط سعر الشحن الثابت على ${value} جنيه للطلب.`,
      payload: { key: 'default_shipping_fee', value },
      impactSummary:
        'يؤثر مباشرة على تقدير تكلفة الشحن في كل المقاييس. عدد الطلبات في آخر 30 يوماً × السعر الجديد = التكلفة التقديرية الجديدة.',
      riskLevel: 'medium',
      reversible: true,
    }
  }

  if (isExpense) {
    const amount = parseAmount(question)
    if (amount === null) return null
    const category = /شحن/.test(normalized)
      ? 'shipping'
      : /تغليف|عبوه/.test(normalized)
        ? 'packaging'
        : /اعلان|إعلان/.test(normalized)
          ? 'advertising'
          : 'other'
    return {
      type: 'add_expense',
      title: `تسجيل مصروف ${amount} جنيه`,
      description: `إضافة سطر مصروف بقيمة ${amount} جنيه (${category}).`,
      payload: {
        amount,
        category,
        expense_date: new Date().toISOString().slice(0, 10),
        notes: question.slice(0, 200),
      },
      impactSummary:
        'يخفض "المبيعات ناقص المصروفات" بمقدار المبلغ، ويجعل رقم المصروفات التشغيلية حقيقياً بدل صفر غير مسجّل.',
      riskLevel: 'low',
      reversible: true,
    }
  }

  if (isCost) {
    const cost = parseAmount(question)
    if (cost === null) return null
    const products = await listProductOptions(db)
    const product = matchProduct(question, products)
    if (!product) return null

    return {
      type: 'set_product_cost',
      title: `تسجيل تكلفة "${product.name}"`,
      description: `ضبط تكلفة الوحدة لمنتج "${product.name}" (${product.sku}) على ${cost} جنيه.`,
      payload: { product_id: product.id, cost_price: cost },
      impactSummary:
        'يتيح احتساب تكلفة المنتجات، ومعها صافي الربح وقيمة المخزون وهامش كل منتج. حتى ذلك الحين، الربح محجوب.',
      riskLevel: 'low',
      reversible: true,
    }
  }

  return null
}

export const ACTION_TYPE_LABELS: Record<ApprovalActionType, string> = {
  set_product_cost: 'تكلفة منتج',
  add_expense: 'مصروف',
  set_business_setting: 'إعداد النشاط',
}
