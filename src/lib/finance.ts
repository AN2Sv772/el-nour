/**
 * Pure financial calculation engine — the single source of truth for
 * provisional/reconciled profit. No DB access, fully unit-testable.
 *
 * Business rules (approved):
 *  - Imported/manual orders are provisionally delivered by default.
 *  - Provisional profit = collected revenue − product COGS − all expenses.
 *    COGS uses the HISTORICAL unit-cost snapshot on each order line,
 *    falling back to the product's current cost when no snapshot exists.
 *  - End-of-day reconciliation: user records how many orders were returned
 *    and which products/quantities were physically received back.
 *  - Cash impact of a returned order: customer pays nothing → revenue for
 *    those orders is reversed. Which exact orders returned is not recorded,
 *    so the revenue reversal is an ESTIMATE (count × avg order value) and is
 *    always labeled as such in the UI.
 *  - Inventory impact: only physically received products restore stock, at
 *    the product's current cost, snapshotted into the reconciliation row.
 *  - Reconciled profit = provisional profit − returned-orders revenue
 *    estimate + returned products value (cost recovered into stock).
 */

export interface FinanceOrder {
  total_amount: number
  shipping_fee: number
  status: string
  reconciliation_status?: string | null
}

export interface FinanceOrderItem {
  order_id: string
  quantity: number
  unit_cost: number | null
}

export interface FinanceExpense {
  amount: number
  category: string
  voided_at?: string | null
}

/** Orders that count toward provisional sales (not cancelled). */
export function isCountedOrder(o: FinanceOrder): boolean {
  return !['cancelled', 'returned'].includes(o.status)
}

export interface ProvisionalResult {
  orders_count: number
  provisional_sales: number
  provisional_cogs: number
  shipping_collected: number
  expenses_total: number
  provisional_profit: number
}

/**
 * Provisional (pre-reconciliation) figures for a set of orders.
 * @param orders   orders in the period (all statuses; filtered internally)
 * @param items    order_lines belonging to those orders (any status input is
 *                 filtered by matching counted order ids)
 * @param expenses active (non-void) expenses in the period
 */
export function computeProvisional(
  orders: FinanceOrder[],
  items: FinanceOrderItem[],
  expenses: FinanceExpense[],
  unitCostByProductFallback: Record<string, number> = {},
  productIdByItem: Record<string, string> = {}
): ProvisionalResult {
  const counted = orders.filter(isCountedOrder)
  const countedIds = new Set(counted.map(o => (o as unknown as { id: string }).id))

  const provisional_sales = round2(counted.reduce((s, o) => s + (o.total_amount || 0), 0))
  const shipping_collected = round2(counted.reduce((s, o) => s + (o.shipping_fee || 0), 0))

  const provisional_cogs = round2(
    items
      .filter(it => countedIds.has(it.order_id))
      .reduce((s, it) => {
        const fallback = unitCostByProductFallback[productIdByItem[it.order_id] ?? ''] ?? 0
        const unitCost = it.unit_cost ?? fallback
        return s + (it.quantity || 0) * (unitCost || 0)
      }, 0)
  )

  const expenses_total = round2(
    expenses.filter(e => !e.voided_at).reduce((s, e) => s + (e.amount || 0), 0)
  )

  return {
    orders_count: counted.length,
    provisional_sales,
    provisional_cogs,
    shipping_collected,
    expenses_total,
    provisional_profit: round2(provisional_sales - provisional_cogs - expenses_total),
  }
}

export interface ReconciliationInput {
  provisional: ProvisionalResult
  returnedOrdersCount: number
  /** products physically received back: qty × current cost snapshot */
  returnedItems: { quantity_returned: number; unit_cost: number }[]
}

export interface ReconciledResult extends ProvisionalResult {
  returned_orders_count: number
  /** ESTIMATE: returned count × average order value — labeled تقديري in UI */
  returned_orders_value: number
  /** EXACT: Σ qty × unit cost of physically received products */
  returned_products_value: number
  reconciled_profit: number
}

export function computeReconciled(input: ReconciliationInput): ReconciledResult {
  const { provisional, returnedOrdersCount, returnedItems } = input

  const avgOrderValue =
    provisional.orders_count > 0
      ? provisional.provisional_sales / provisional.orders_count
      : 0

  const returned_orders_value = round2(returnedOrdersCount * avgOrderValue)
  const returned_products_value = round2(
    returnedItems.reduce((s, it) => s + Math.max(0, it.quantity_returned) * (it.unit_cost || 0), 0)
  )

  const reconciled_profit = round2(
    provisional.provisional_profit - returned_orders_value + returned_products_value
  )

  return {
    ...provisional,
    returned_orders_count: returnedOrdersCount,
    returned_orders_value,
    returned_products_value,
    reconciled_profit,
  }
}

/** Egypt wa.me deep link. Handles 010…/011…/012…/015…, +20…, 20…, and intl. */
export function buildWaLink(rawPhone: string): string | null {
  if (!rawPhone) return null
  const digits = rawPhone.replace(/\D/g, '')

  // Already has a country code that is not 20 → use as-is
  if (digits.length > 11 && !digits.startsWith('20')) {
    return `https://wa.me/${digits}`
  }
  // 20 + 10-digit local → strip leading 20, re-prefix 20
  if (digits.startsWith('20') && digits.length === 12) {
    return `https://wa.me/${digits}`
  }
  // Local Egyptian mobile 0XXXXXXXXXX (11 digits, starts 0)
  if (digits.length === 11 && digits.startsWith('0')) {
    return `https://wa.me/20${digits.slice(1)}`
  }
  // 10 digits without leading 0 (Egyptian mobile without 0)
  if (digits.length === 10 && digits.startsWith('1')) {
    return `https://wa.me/20${digits}`
  }
  return null
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// ═══════════════════════════════════════════════════════════════════════════
// Shipping-company collection reconciliation (مطابقة تحصيل شركات الشحن)
// ═══════════════════════════════════════════════════════════════════════════

export interface AllocatableOrder {
  id: string
  total_amount: number
  status: string
  /** true when the order is already allocated to another batch */
  already_allocated?: boolean
}

export interface CollectionDeductionInput {
  label: string
  amount: number
}

export interface CollectionBatchCalc {
  /** orders eligible for settlement: allocated to this batch, delivered-ish, not already counted elsewhere */
  allocated_orders_count: number
  /** Σ total_amount of eligible allocated orders (COD collected by company) */
  gross_collected: number
  /** returned/cancelled allocated orders excluded from settlement */
  excluded_orders_count: number
  deductions_total: number
  /** expected transfer = gross collected − company deductions */
  expected_amount: number
  /** actual received (input) */
  received_amount: number
  /** received − expected (negative = outstanding owed to the business) */
  difference: number
  /** matched when |difference| < 0.01 */
  is_matched: boolean
}

/**
 * Transparent, auditable settlement calculation for one batch.
 * - Only allocated orders count (prevents double-counting revenue).
 * - cancelled/returned allocated orders are excluded (company never collected them).
 * - Company deductions are separate line items, NEVER mixed with the
 *   business's own shipping expense.
 */
export function computeCollectionBatch(
  orders: AllocatableOrder[],
  deductions: CollectionDeductionInput[],
  receivedAmount: number
): CollectionBatchCalc {
  const eligible = orders.filter(o => !['cancelled', 'returned'].includes(o.status))
  const excluded = orders.length - eligible.length

  const grossCollected = round2(eligible.reduce((s, o) => s + (o.total_amount || 0), 0))
  const deductionsTotal = round2(deductions.reduce((s, d) => s + Math.max(0, d.amount || 0), 0))
  const expected = round2(grossCollected - deductionsTotal)
  const received = round2(Math.max(0, receivedAmount || 0))
  const difference = round2(received - expected)

  return {
    allocated_orders_count: eligible.length,
    gross_collected: grossCollected,
    excluded_orders_count: excluded,
    deductions_total: deductionsTotal,
    expected_amount: expected,
    received_amount: received,
    difference,
    is_matched: Math.abs(difference) < 0.01,
  }
}
