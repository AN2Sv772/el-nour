import { createServiceClient } from '@/lib/supabase/service'
import { easyOrdersService } from './service'
import { normalizePhoneNumber, normalizePhoneForStorage, fitToColumn, MAX_PHONE_LENGTH } from '@/lib/utils'
import type { 
  EasyOrdersOrder, 
  EasyOrdersCartItem,
  EasyOrdersSyncJob,
  EasyOrdersSyncStats,
  EasyOrdersWebhookPayload,
  EasyOrdersStatusChangePayload,
  Order,
  Customer,
  OrderItem,
  ShippingAddress,
  PaymentMethod,
  OrderStatus,
  PaymentStatus,
  EasyOrdersProduct,
  EasyOrdersVariant,
  EasyOrdersVariationProp,
} from '@/types'

interface EasyOrdersCartItemWithDetails extends EasyOrdersCartItem {
  product: EasyOrdersProduct
  variant: EasyOrdersVariant | null
}

interface EasyOrdersOrderWithDetails extends EasyOrdersOrder {
  cart_items: EasyOrdersCartItemWithDetails[]
}

interface EasyOrdersStatusUpdatePayload {
  event_type: 'order-status-update'
  order_id: string
  old_status: string
  new_status: string
  payment_ref_id: string | null
}

interface EasyOrdersOrderCreatedPayload {
  id: string
  updated_at: string
  created_at: string
  store_id: string
  cost: number
  shipping_cost: number
  total_cost: number
  status: string
  full_name: string
  phone: string
  government: string
  address: string
  payment_method: string
  cart_items: EasyOrdersCartItemWithDetails[]
}

type EasyOrdersWebhookEvent = 
  | { event_type: 'order-created'; data: EasyOrdersOrderCreatedPayload }
  | { event_type: 'order-status-update'; data: EasyOrdersStatusChangePayload }
  | { event_type: string; data: unknown }

/**
 * Outcome of processing one EasyOrders event.
 *   created → a new order row was written
 *   skipped → the order already existed (idempotent no-op)
 *   updated → a status-only change was applied
 *   ignored → the event type is not handled
 */
export interface SyncOutcome {
  outcome: 'created' | 'skipped' | 'updated' | 'ignored'
  orderId?: string
}

/**
 * Minimal surface of the Supabase client the stamp needs.
 *
 * `PromiseLike` (not `Promise`) because the PostgREST builder is a thenable,
 * not a real Promise — using `Promise` here would reject a perfectly valid
 * client at the type level.
 */
type StampClient = {
  from: (table: string) => {
    select: (cols: string) => {
      limit: (n: number) => {
        maybeSingle: () => PromiseLike<{ data: StampConfig | null }>
      }
    }
    update: (values: Record<string, unknown>) => {
      eq: (col: string, val: string) => PromiseLike<unknown>
    }
    insert?: (values: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => PromiseLike<{ data: unknown; error?: unknown }>
      }
    }
  }
  rpc?: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data?: unknown; error?: { message?: string; code?: string } | null }>
}

export interface StampConfig {
  id: string
  total_imported_orders?: number | null
  total_updated_orders?: number | null
}

/**
 * The atomic counter increment lives in the database
 * (`public.increment_easyorders_counters`, migration
 * `20260122000000_easyorders_atomic_sync_log.sql`).
 *
 * WHY: the previous implementation read the counter and wrote `<read> + 1`.
 * Two import workers that read the same base value overwrite each other, so
 * increments are lost. The live project shows it: the panel reported
 * `total_imported_orders = 19` while `automation_logs` held 2 022 successful
 * imports.
 */
export const ATOMIC_COUNTER_RPC = 'increment_easyorders_counters'

/**
 * The per-run sync log lives in the database
 * (`public.record_easyorders_sync_run`), so the row is written atomically by
 * the database instead of by the application.
 *
 * It deliberately does NOT update the import counters: those are incremented
 * PER ORDER by `increment_easyorders_counters`, and adding the run totals on
 * top of them would count every imported order twice.
 */
export const SYNC_RUN_RPC = 'record_easyorders_sync_run'

function isMissingFunction(error?: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  const code = error.code ?? ''
  const message = error.message ?? ''
  return (
    code === '42883' ||
    code === 'PGRST202' ||
    /does not exist|not found|function .* not/i.test(message)
  )
}

/**
 * Record that a sync actually moved data.
 *
 * Both import paths (the webhook queue and the daily catch-up backfill) go
 * through `processWebhookEvent`, so this is the one place where the "last
 * sync" metadata can be kept truthful. Without it the Settings screen
 * reports the date of the last MANUAL sync and hides the fact that orders
 * keep arriving in the background — the operator cannot tell when the
 * dashboard was last refreshed.
 *
 * A skipped or ignored outcome must NOT move the timestamp: nothing was
 * imported, so claiming a fresh sync would be a lie.
 *
 * The counter increment is ATOMIC (database function) when the migration is
 * applied; without it the function falls back to the previous
 * read-modify-write so the code stays deployable in any order.
 *
 * Best-effort: metadata must never abort an import.
 */
export async function stampEasyOrdersSync(
  supabase: StampClient,
  outcome: SyncOutcome['outcome'],
  now: Date = new Date()
): Promise<boolean> {
  if (outcome !== 'created' && outcome !== 'updated') return false
  const imported = outcome === 'created' ? 1 : 0
  const updated = outcome === 'updated' ? 1 : 0

  // 1) Preferred: atomic increment inside the database.
  if (typeof supabase.rpc === 'function') {
    try {
      const { error } = await supabase.rpc(ATOMIC_COUNTER_RPC, {
        p_imported: imported,
        p_updated: updated,
        p_skipped: 0,
        p_last_sync_at: now.toISOString(),
        p_status: 'success',
        p_error: null,
      })
      if (!error) return true
      if (!isMissingFunction(error)) {
        console.error('stampEasyOrdersSync failed:', error.message)
        return false
      }
      // The migration is not applied yet — fall through to the legacy path.
    } catch (e) {
      console.error('stampEasyOrdersSync rpc failed:', e)
      return false
    }
  }

  // 2) Fallback (migration not applied): the old read-modify-write.
  try {
    const { data: config } = await supabase
      .from('easyorders_config')
      .select('id, total_imported_orders, total_updated_orders')
      .limit(1)
      .maybeSingle()
    if (!config) return false
    await supabase
      .from('easyorders_config')
      .update({
        last_sync_at: now.toISOString(),
        last_sync_status: 'success',
        last_sync_error: null,
        total_imported_orders:
          (config.total_imported_orders ?? 0) + imported,
        total_updated_orders:
          (config.total_updated_orders ?? 0) + updated,
      })
      .eq('id', config.id)
    return true
  } catch (e) {
    console.error('stampEasyOrdersSync failed:', e)
    return false
  }
}

/** The counters of one import run. */
export interface EasyOrdersSyncRunSummary {
  syncType: 'manual' | 'catch-up' | 'backfill' | 'queue' | 'webhook' | (string & {})
  status?: 'success' | 'failed' | 'running' | (string & {})
  processed?: number
  imported?: number
  updated?: number
  skipped?: number
  failed?: number
  durationMs?: number
  triggeredBy?: string | null
  errors?: unknown[]
  error?: string | null
  lastSyncAt?: Date
}

/**
 * Write ONE `easyorders_sync_logs` row for an import run (F-013).
 *
 * BEFORE: only the manual sync route wrote to `easyorders_sync_logs`, so the
 * scanners — the paths that actually import the store's orders — left no
 * trace. The table stopped at 2026-11-06 while 2 022 orders were imported
 * afterwards.
 *
 * The counters are NOT touched here: they are incremented per order by
 * `stampEasyOrdersSync` (atomically, through
 * `increment_easyorders_counters`). Adding the run totals here would count
 * every imported order twice.
 *
 * Without the migration the helper falls back to a direct INSERT.
 *
 * Best-effort: a logging failure must never abort an import.
 */
export async function recordEasyOrdersSyncRun(
  supabase: StampClient,
  summary: EasyOrdersSyncRunSummary
): Promise<boolean> {
  const now = summary.lastSyncAt ?? new Date()
  const processed = summary.processed ?? 0
  const imported = summary.imported ?? 0
  const updated = summary.updated ?? 0
  const skipped = summary.skipped ?? 0
  const failed = summary.failed ?? 0
  const status = summary.status ?? 'success'
  const errors = summary.errors ?? []

  if (typeof supabase.rpc === 'function') {
    try {
      const { error } = await supabase.rpc(SYNC_RUN_RPC, {
        p_sync_type: summary.syncType,
        p_status: status,
        p_orders_processed: processed,
        p_orders_imported: imported,
        p_orders_updated: updated,
        p_orders_skipped: skipped,
        p_orders_failed: failed,
        p_duration_ms: summary.durationMs ?? 0,
        p_triggered_by: summary.triggeredBy ?? null,
        p_errors: errors,
        p_last_sync_at: now.toISOString(),
        p_sync_error: summary.error ?? null,
      })
      if (!error) return true
      if (!isMissingFunction(error)) {
        console.error('recordEasyOrdersSyncRun failed:', error.message)
        return false
      }
      // The migration is not applied yet — fall through to the legacy path.
    } catch (e) {
      console.error('recordEasyOrdersSyncRun rpc failed:', e)
      return false
    }
  }

  // Fallback (migration not applied): direct INSERT + legacy counter update.
  try {
    const table = supabase.from('easyorders_sync_logs')
    if (typeof table.insert !== 'function') {
      console.error('recordEasyOrdersSyncRun failed: insert is not available on the client')
      return false
    }
    const insert = table.insert.bind(table)
    const row = {
      sync_type: summary.syncType,
      status,
      orders_processed: processed,
      orders_imported: imported,
      orders_updated: updated,
      orders_skipped: skipped,
      orders_failed: failed,
      errors,
      duration_ms: summary.durationMs ?? 0,
      triggered_by: summary.triggeredBy ?? null,
    }
    // PostgREST reports a rejected row in the RESPONSE, not as a thrown
    // exception, so the error object has to be inspected explicitly —
    // otherwise a CHECK violation would silently drop the audit row.
    // Some client wrappers throw instead, so both shapes are handled.
    const attempt = async (
      values: Record<string, unknown>
    ): Promise<{ error: { message?: string } | null }> => {
      try {
        const result = await insert(values).select('id').single()
        const raw = result?.error
        if (!raw) return { error: null }
        return {
          error:
            typeof raw === 'object' && raw !== null
              ? (raw as { message?: string })
              : { message: String(raw) },
        }
      } catch (thrown) {
        return { error: thrown instanceof Error ? thrown : { message: String(thrown) } }
      }
    }

    const first = await attempt(row)
    if (first.error) {
      // `sync_type` is constrained to
      //   ('manual','webhook','scheduled','retry')
      // until the migration widens it to include 'backfill' / 'catch-up'.
      // A rejected row means a LOST audit trail, so retry with the
      // pre-existing value instead of dropping the run.
      const message = first.error.message ?? String(first.error)
      if (!/sync_type|check constraint|violates/i.test(message)) throw first.error
      const retry = await attempt({ ...row, sync_type: 'scheduled' })
      if (retry.error) throw retry.error
    }

    // The counters are NOT updated here — `stampEasyOrdersSync` already
    // incremented them once per imported/updated order.
    return true
  } catch (e) {
    console.error('recordEasyOrdersSyncRun failed:', e)
    return false
  }
}

/**
 * Produce a phone that is unique but still recognisable, when the stored
 * (possibly truncated) phone collides with an existing customer.
 * The suffix is derived from the ORIGINAL number, so it is stable across
 * re-runs of the same import.
 */
export function disambiguatePhone(storedPhone: string, originalPhone: string): string {
  let hash = 0
  const source = originalPhone || storedPhone
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0
  }
  const suffix = String(hash % 10000).padStart(4, '0')
  return `${storedPhone.slice(0, MAX_PHONE_LENGTH - suffix.length - 1)}-${suffix}`
}

/**
 * Prefix that marks `orders.easyorders_sync_cursor` as holding the REMOTE
 * version of the order (`v:<ISO timestamp>`) rather than a local timestamp.
 *
 * The column was originally written with the local processing time, which
 * made it impossible to tell "remote version" from "when we imported it".
 * The prefix makes the two unambiguous without a schema migration.
 */
export const CURSOR_VERSION_PREFIX = 'v:'

/** Format the sync cursor for a remote version. */
export function formatSyncCursor(remoteUpdatedAt?: string | null): string {
  if (remoteUpdatedAt && Number.isFinite(Date.parse(remoteUpdatedAt))) {
    return `${CURSOR_VERSION_PREFIX}${remoteUpdatedAt}`
  }
  // No remote version in the payload — record the local time so the row is
  // still "versioned" and a later delivery can be compared against it.
  return new Date().toISOString()
}

export class EasyOrdersSyncService {
  private supabase = createServiceClient()

  // Status mapping from EasyOrders to local
  private statusMap: Record<string, { local: string; mapped: boolean }> = {
    'pending': { local: 'pending', mapped: true },
    'awaiting_confirmation': { local: 'awaiting_confirmation', mapped: true },
    'confirmed': { local: 'confirmed', mapped: true },
    'processing': { local: 'preparing', mapped: true },
    'preparing': { local: 'preparing', mapped: true },
    'ready_for_shipping': { local: 'ready_for_shipping', mapped: true },
    'ready_to_ship': { local: 'ready_for_shipping', mapped: true },
    'shipped': { local: 'shipped', mapped: true },
    'out_for_delivery': { local: 'out_for_delivery', mapped: true },
    'out_for_deliver': { local: 'out_for_delivery', mapped: true },
    'delivered': { local: 'delivered', mapped: true },
    'cancelled': { local: 'cancelled', mapped: true },
    'returned': { local: 'returned', mapped: true },
    'returned_partially': { local: 'returned', mapped: true },
    'failed_delivery': { local: 'failed_delivery', mapped: true },
    'return_requested': { local: 'pending', mapped: false },
    'refunded': { local: 'returned', mapped: true },
    'paid': { local: 'confirmed', mapped: true },
  }

  mapStatus(easyordersStatus: string): { localStatus: string; isMapped: boolean } {
    const mapping = this.statusMap[easyordersStatus?.toLowerCase() || '']
    if (mapping) {
      return { localStatus: mapping.local, isMapped: mapping.mapped }
    }
    return { localStatus: 'pending', isMapped: false }
  }

  // Normalize phone number for EasyOrders (uses the shared utility)
  normalizePhoneForEasyOrders(phone: string): string {
    return normalizePhoneNumber(phone)
  }

  // Find or create customer from EasyOrders data
  async findOrCreateCustomer(order: EasyOrdersOrderWithDetails): Promise<string> {
    // customers.phone is VARCHAR(20) UNIQUE — the stored value must fit the
    // column, otherwise the insert fails with 22001 and the whole order
    // import is lost.
    const phone = normalizePhoneForStorage(order.phone)

    // maybeSingle (not single): `single` errors when the phone matches 0 rows —
    // and it also errors when 2+ rows share a phone (legacy duplicate data).
    // Both cases must not abort the order import.
    const { data: customer, error: lookupError } = await this.supabase
      .from('customers')
      .select('*')
      .eq('phone', phone)
      .maybeSingle()

    if (lookupError) {
      // Ambiguous lookup (multiple rows share the phone) — fall back to the
      // oldest match instead of failing the whole order import.
      const { data: fallback, error: fallbackError } = await this.supabase
        .from('customers')
        .select('*')
        .eq('phone', phone)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (fallbackError) throw fallbackError
      if (fallback) {
        await this.supabase
          .from('customers')
          .update({ last_interaction_at: new Date().toISOString() })
          .eq('id', fallback.id)
        return fallback.id
      }
    }

    if (customer) {
      // Update last interaction
      await this.supabase
        .from('customers')
        .update({ last_interaction_at: new Date().toISOString() })
        .eq('id', customer.id)
      return customer.id
    }

    // Create new customer
    const { data: newCustomer, error } = await this.supabase
      .from('customers')
      .insert({
        phone,
        name: fitToColumn(order.full_name ?? '', 255),
        address: order.address,
        governorate: fitToColumn(order.government ?? '', 100),
        city: fitToColumn(order.government ?? '', 100), // EasyOrders uses government field
        last_interaction_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      // 23505: the phone is already taken. This happens when a long number
      // was truncated into an existing one. Disambiguate deterministically
      // so the ORDER still imports instead of being lost.
      if (error.code === '23505') {
        const disambiguated = disambiguatePhone(phone, order.phone)
        const { data: retryCustomer, error: retryError } = await this.supabase
          .from('customers')
          .insert({
            phone: disambiguated,
            name: fitToColumn(order.full_name ?? '', 255),
            address: order.address,
            governorate: fitToColumn(order.government ?? '', 100),
            city: fitToColumn(order.government ?? '', 100),
            last_interaction_at: new Date().toISOString(),
          })
          .select()
          .single()
        if (retryError) throw retryError
        return retryCustomer.id
      }
      throw error
    }
    return newCustomer.id
  }

  // Find or create product from EasyOrders data.
  // REAL PAYLOADS: the sku field is often ABSENT on /orders/short payloads —
  // match by external product id (mapped via easyorders_product_id), then
  // name, then create with a synthesized stable SKU.
  async findOrCreateProduct(item: EasyOrdersCartItemWithDetails): Promise<string> {
    const externalId: string | undefined = item.product?.id
    const rawSku: string | undefined = item.product?.sku
    const fallbackName = item.product?.name || 'unknown'
    // products.sku is VARCHAR(100) — the name-based fallback can exceed it.
    const stableSku = fitToColumn(rawSku || (externalId ? `EO-${externalId}` : `EO-${fallbackName}`), 100)

    // 1. Match by external product id (most stable) — tolerant if the column
    //    migration hasn't been applied yet
    if (externalId) {
      try {
        const { data: byExternal, error: extErr } = await this.supabase
          .from('products')
          .select('*')
          .eq('easyorders_product_id', externalId)
          .maybeSingle()
        if (!extErr && byExternal) return byExternal.id
      } catch {
        // column missing — fall through to SKU matching
      }
    }

    // 2. Match by SKU
    const { data: bySku } = await this.supabase
      .from('products')
      .select('*')
      .eq('sku', stableSku)
      .maybeSingle()
    if (bySku) return bySku.id

    // 3. Match by name
    const { data: byName } = await this.supabase
      .from('products')
      .select('*')
      .eq('name', item.product?.name || '')
      .maybeSingle()
    if (byName) return byName.id

    // 4. Create with the stable SKU
    const { data: newProduct, error } = await this.supabase
      .from('products')
      .insert({
        sku: stableSku,
        name: item.product?.name || 'منتج EasyOrders',
        name_ar: item.product?.name || 'منتج EasyOrders',
        price: item.price ?? 0,
        cost_price: 0,
        stock_quantity: 0,
        track_inventory: false,
        low_stock_threshold: 5,
        description: item.product?.name || null,
        ...(externalId ? { easyorders_product_id: externalId } : {}),
      })
      .select()
      .single()

    if (error) {
      // Retry without the external-id column if it doesn't exist yet
      if (error.message?.includes('easyorders_product_id')) {
        const { data: retry, error: retryErr } = await this.supabase
          .from('products')
          .insert({
            sku: stableSku,
            name: item.product?.name || 'منتج EasyOrders',
            name_ar: item.product?.name || 'منتج EasyOrders',
            price: item.price ?? 0,
            cost_price: 0,
            stock_quantity: 0,
            track_inventory: false,
            low_stock_threshold: 5,
            description: item.product?.name || null,
          })
          .select()
          .single()
        if (retryErr) throw retryErr
        return retry.id
      }
      throw error
    }
    return newProduct.id
  }

  /**
   * Create an order from EasyOrders data.
   *
   * Returns `{ id, created }`:
   *   created: true  → a new order row was written
   *   created: false → the order already existed (unique-index collision),
   *                    which is NOT an error — the import is idempotent.
   */
  async createOrderFromEasyOrders(
    easyOrder: EasyOrdersOrderWithDetails,
    customerId: string,
    configId: string
  ): Promise<{ id: string; created: boolean }> {
    // Calculate totals from cart items + capture cost snapshot per line
    let subtotal = 0
    const items: Omit<OrderItem, 'id' | 'order_id'>[] = []
    const unitCostByProduct: Record<string, number> = {}

    for (const item of easyOrder.cart_items) {
      const productId = await this.findOrCreateProduct(item)
      const { data: prodRow } = await this.supabase
        .from('products')
        .select('cost_price')
        .eq('id', productId)
        .single()
      unitCostByProduct[productId] = prodRow?.cost_price ?? 0

      // Coerce every numeric input. A cart item with a missing `price` or
      // `quantity` used to make `unitPrice * quantity` NaN, which made the
      // order's `subtotal` NaN → serialised as NULL → the INSERT failed with
      // 23502 and the order was lost entirely (this is how historical
      // orders went missing during the backfill).
      const parsedPrice = Number(item.price)
      const parsedQty = Number(item.quantity)
      const unitPrice = Number.isFinite(parsedPrice) ? parsedPrice : 0
      const quantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1
      const totalPrice = unitPrice * quantity
      subtotal += totalPrice

      if (!Number.isFinite(parsedPrice) || !Number.isFinite(parsedQty)) {
        console.warn(
          `EasyOrders item ${item.id ?? 'unknown'} has a non-numeric price/quantity ` +
            `(${JSON.stringify(item.price)}/${JSON.stringify(item.quantity)}) — coerced to ${unitPrice}×${quantity}`
        )
      }

      const variantProps = item.variant?.variation_props?.map((v) =>
        `${v.variation}: ${v.variation_prop}`
      ).join(', ') || null

      items.push({
        product_id: productId,
        variant_id: item.variant_id ?? null,
        product_name: fitToColumn(item.product?.name || 'منتج', 255),
        product_name_ar: fitToColumn(item.product?.name || 'منتج', 255),
        sku: fitToColumn(item.product?.sku || item.product?.id || 'NO-SKU', 100),
        // order_items.variant_name is VARCHAR(100)
        variant_name: variantProps ? fitToColumn(variantProps, 100) : null,
        quantity,
        unit_price: unitPrice,
        unit_cost: unitCostByProduct[productId] ?? 0,
        discount: 0,
        total_price: totalPrice,
      })
    }

    // Calculate totals — every term is coerced to a finite number so a
    // malformed payload can never produce a NULL total.
    const parsedShipping = Number(easyOrder.shipping_cost)
    const shippingFee = Number.isFinite(parsedShipping) ? parsedShipping : 0
    const discountAmount = 0 // EasyOrders doesn't seem to have discount field
    const taxAmount = 0 // EasyOrders doesn't have tax field
    if (!Number.isFinite(subtotal)) subtotal = 0
    const totalAmount = subtotal + shippingFee + taxAmount - discountAmount

    // Generate order number — seeded with the EasyOrders order id so it is
    // deterministic and cannot collide with another order.
    const orderNumber = this.generateOrderNumber(easyOrder.id)

    // Map status
    const { localStatus, isMapped } = this.mapStatus(easyOrder.status)
    if (!isMapped) {
      console.warn(`Unmapped EasyOrders status: ${easyOrder.status}`)
    }

    // Build shipping address
    const shippingAddress: ShippingAddress = {
      name: easyOrder.full_name,
      phone: this.normalizePhoneForEasyOrders(easyOrder.phone),
      address: easyOrder.address,
      city: easyOrder.government,
      governorate: easyOrder.government,
      postal_code: null,
      landmark: null,
      coordinates: null,
    }

    // Create order — preserve the ORIGINAL EasyOrders creation timestamp
    const originalCreatedAt = (easyOrder as { created_at?: string }).created_at

    const { data: order, error } = await this.supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        customer_id: customerId,
        status: localStatus,
        ...(originalCreatedAt ? { created_at: originalCreatedAt } : {}),
        payment_status: 'pending',
        payment_method: this.mapPaymentMethod(easyOrder.payment_method),
        subtotal,
        discount_amount: discountAmount,
        shipping_fee: shippingFee,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        items,
        shipping_address: shippingAddress,
        billing_address: shippingAddress,
        source: 'easyorders',
        notes: `Imported from EasyOrders (Order ID: ${easyOrder.id})`,
        internal_notes: `EasyOrders Order ID: ${easyOrder.id}\nEasyOrders Store ID: ${easyOrder.store_id}\nOriginal Status: ${easyOrder.status}`,
        easyorders_order_id: easyOrder.id,
        easyorders_store_id: easyOrder.store_id,
        // The cursor stores the REMOTE version of the order (EasyOrders'
        // `updated_at`), not the local processing time. Storing the local
        // time made a stale delivery look newer than the row it should have
        // updated, so out-of-order deliveries were applied.
        easyorders_sync_cursor: formatSyncCursor(
          (easyOrder as { updated_at?: string }).updated_at
        ),
        easyorders_last_synced_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      // 23505 = the order already exists (unique index idx_orders). This is a
      // benign race (two workers / a re-run), not a failure — resolve the
      // existing row and report created:false so callers can count it as a
      // skip instead of a failure.
      if (error.code === '23505') {
        const existing = await this.findExistingOrder(
          easyOrder.id,
          easyOrder.store_id ?? null
        )
        if (existing) return { id: existing.id, created: false }
      }
      throw error
    }

    // Create order items
    const orderItems = items.map(item => ({
      ...item,
      order_id: order.id,
    }))

    const { error: itemsError } = await this.supabase
      .from('order_items')
      .insert(orderItems)

    if (itemsError) {
      // COMPENSATING ROLLBACK. The order row was already written, so a
      // failed items insert used to leave a half-imported order: an order
      // with no line items and no automation log, that no retry could ever
      // repair (the unique index rejected the re-import). Removing the
      // order row makes the import atomic from the caller's point of view
      // and lets the next attempt redo it cleanly.
      console.error(
        `createOrderFromEasyOrders: items insert failed for order ${order.id} ` +
          `(${easyOrder.id}) — rolling the order row back: ${itemsError.message}`
      )
      await this.supabase.from('orders').delete().eq('id', order.id)
      await this.supabase.from('automation_logs').insert({
        type: 'order_created',
        status: 'failed',
        reference_id: order.id,
        reference_type: 'order',
        details: {
          easyorders_order_id: easyOrder.id,
          easyorders_store_id: easyOrder.store_id,
          source: 'easyorders',
          error: itemsError.message,
        },
      })
      throw itemsError
    }

    // Log automation
    await this.supabase.from('automation_logs').insert({
      type: 'order_created',
      status: 'success',
      reference_id: order.id,
      reference_type: 'order',
      details: { 
        easyorders_order_id: easyOrder.id,
        easyorders_store_id: easyOrder.store_id,
        source: 'easyorders',
      }
    })

    return { id: order.id, created: true }
  }

  /**
   * Check whether an EasyOrders order was already imported.
   *
   * The unique index `idx_orders` is on (easyorders_order_id,
   * easyorders_store_id) — the lookup MUST mirror that column set exactly,
   * otherwise the pre-check misses rows that the insert then rejects with
   * 23505 (the historical backfill failure mode).
   *
   * Returns:
   *   { exists: true }  → already imported
   *   { exists: false } → safe to import
   * Throws on a genuine query failure so the caller retries instead of
   * blindly attempting an insert that is bound to collide.
   */
  private async findExistingOrder(
    easyordersOrderId: string,
    easyordersStoreId: string | null
  ): Promise<{ id: string } | null> {
    let query = this.supabase
      .from('orders')
      .select('id')
      .eq('easyorders_order_id', easyordersOrderId)

    if (easyordersStoreId) {
      query = query.eq('easyorders_store_id', easyordersStoreId)
    }

    const { data, error } = await query.limit(1).maybeSingle()
    if (error) throw error
    return data ?? null
  }

  private async handleOrderCreated(
    payload: EasyOrdersOrderCreatedPayload
  ): Promise<SyncOutcome> {
    const easyOrder = payload as EasyOrdersOrderWithDetails

    // Idempotent: skip if already imported. The lookup mirrors the unique
    // index and its errors are surfaced (never swallowed) so a transient
    // read failure becomes a retryable queue error, not a phantom 23505.
    const existing = await this.findExistingOrder(
      easyOrder.id,
      easyOrder.store_id ?? null
    )
    if (existing) {
      // The order already exists — but EasyOrders may have CHANGED it since
      // it was first imported (a status change, a corrected total). The
      // delivery is only ignored when it is genuinely STALE.
      const reconciled = await this.reconcileExistingOrder(existing.id, easyOrder)
      return { outcome: reconciled ? 'updated' : 'skipped', orderId: existing.id }
    }

    const customerId = await this.findOrCreateCustomer(easyOrder)
    const result = await this.createOrderFromEasyOrders(easyOrder, customerId, '')
    return result.created
      ? { outcome: 'created', orderId: result.id }
      : { outcome: 'skipped', orderId: result.id }
  }

  /**
   * Apply an EasyOrders delivery to an order that was already imported.
   *
   * STALE GUARD: a delivery is only applied when the remote `updated_at` is
   * NEWER than the remote version we last applied (`easyorders_sync_cursor`).
   * Without this, a delivery that arrives out of order (the common case with
   * webhook retries) overwrites newer data with older data.
   *
   * Returns true when the order was changed.
   */
  private async reconcileExistingOrder(
    orderId: string,
    easyOrder: EasyOrdersOrderWithDetails
  ): Promise<boolean> {
    const remoteUpdatedAt = (easyOrder as { updated_at?: string }).updated_at
    if (!remoteUpdatedAt) {
      // No remote version in the payload — we cannot tell whether it is
      // stale, so leave the row untouched rather than risk a rollback.
      return false
    }

    const { data: local, error } = await this.supabase
      .from('orders')
      .select('id, status, subtotal, total_amount, easyorders_sync_cursor, easyorders_store_id')
      .eq('id', orderId)
      .single()
    if (error) throw error

    // The applied version tells us whether this delivery is newer than what
    // we already have:
    //   'v:<iso>'  → the remote version we last applied (new format)
    //   '<iso>'    → a legacy cursor written by the old importer: the LOCAL
    //                time of the import. It is a conservative lower bound —
    //                the imported state already included everything that
    //                happened up to that moment.
    //   null       → unknown → we must not touch the row (fail safe).
    const appliedVersion = local?.easyorders_sync_cursor
    let lastAppliedAt: number | null = null
    if (appliedVersion) {
      const raw = appliedVersion.startsWith(CURSOR_VERSION_PREFIX)
        ? appliedVersion.slice(CURSOR_VERSION_PREFIX.length)
        : appliedVersion
      const parsed = Date.parse(raw)
      if (Number.isFinite(parsed)) lastAppliedAt = parsed
    }
    if (lastAppliedAt === null) return false

    const incomingAt = Date.parse(remoteUpdatedAt)
    if (Number.isFinite(incomingAt) && incomingAt <= lastAppliedAt) {
      // Stale delivery — the row already holds a newer version.
      return false
    }

    const { localStatus } = this.mapStatus(easyOrder.status)
    const parsedShipping = Number(easyOrder.shipping_cost)
    const shippingFee = Number.isFinite(parsedShipping) ? parsedShipping : 0

    // Recompute the line items from the payload so the totals stay
    // consistent with the items.
    let subtotal = 0
    const itemRows: Omit<OrderItem, 'id' | 'order_id'>[] = []
    for (const item of easyOrder.cart_items ?? []) {
      const productId = await this.findOrCreateProduct(item)
      const parsedPrice = Number(item.price)
      const parsedQty = Number(item.quantity)
      const unitPrice = Number.isFinite(parsedPrice) ? parsedPrice : 0
      const quantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : 1
      const totalPrice = unitPrice * quantity
      subtotal += totalPrice
      itemRows.push({
        product_id: productId,
        variant_id: item.variant_id ?? null,
        product_name: fitToColumn(item.product?.name || 'منتج', 255),
        product_name_ar: fitToColumn(item.product?.name || 'منتج', 255),
        sku: fitToColumn(item.product?.sku || item.product?.id || 'NO-SKU', 100),
        variant_name: null,
        quantity,
        unit_price: unitPrice,
        unit_cost: 0,
        discount: 0,
        total_price: totalPrice,
      })
    }
    if (!Number.isFinite(subtotal)) subtotal = 0
    const totalAmount = subtotal + shippingFee

    const shippingAddress: ShippingAddress = {
      name: easyOrder.full_name,
      phone: this.normalizePhoneForEasyOrders(easyOrder.phone),
      address: easyOrder.address,
      city: easyOrder.government,
      governorate: easyOrder.government,
      postal_code: null,
      landmark: null,
      coordinates: null,
    }

    const { error: updateError } = await this.supabase
      .from('orders')
      .update({
        status: localStatus,
        subtotal,
        shipping_fee: shippingFee,
        total_amount: totalAmount,
        shipping_address: shippingAddress,
        billing_address: shippingAddress,
        easyorders_sync_cursor: formatSyncCursor(remoteUpdatedAt),
        easyorders_last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId)
    if (updateError) throw updateError

    // Replace the line items when the payload actually carries them.
    if (itemRows.length > 0) {
      await this.supabase.from('order_items').delete().eq('order_id', orderId)
      const { error: itemsError } = await this.supabase
        .from('order_items')
        .insert(itemRows.map(row => ({ ...row, order_id: orderId })))
      if (itemsError) throw itemsError
    }

    await this.supabase.from('automation_logs').insert({
      type: 'order_updated',
      status: 'success',
      reference_id: orderId,
      reference_type: 'order',
      details: {
        easyorders_order_id: easyOrder.id,
        remote_updated_at: remoteUpdatedAt,
        source: 'easyorders_webhook',
      },
    })

    return true
  }
  private async handleStatusUpdate(payload: EasyOrdersStatusUpdatePayload): Promise<void> {
    const { order_id, new_status, old_status } = payload

    const { data: localOrder, error: lookupError } = await this.supabase
      .from('orders')
      .select('id, status')
      .eq('easyorders_order_id', order_id)
      .limit(1)
      .maybeSingle()
    if (lookupError) throw lookupError

    if (!localOrder) return // Order not in our system yet

    const { localStatus, isMapped } = this.mapStatus(new_status)

    if (!isMapped) {
      console.warn(`Unmapped status from webhook: ${new_status}`)
    }

    // STALE GUARD. The status event carries no timestamp, so the transition
    // itself is the version marker: an event is only applied when the order
    // is still in the state the event says it came FROM.
    //
    //   local == mapped(old_status) → apply the transition
    //   local == mapped(new_status) → already applied, nothing to do
    //   otherwise                   → the order moved on; this delivery is
    //                                 stale, and applying it would roll the
    //                                 order BACKWARDS
    if (old_status) {
      const { localStatus: expectedOld } = this.mapStatus(old_status)
      if (localOrder.status !== expectedOld) {
        if (localOrder.status === localStatus) {
          console.warn(
            `EasyOrders status event for ${order_id} already applied ` +
              `(${expectedOld} → ${localStatus}) — ignoring the duplicate`
          )
          return
        }
        console.warn(
          `EasyOrders status event for ${order_id} is stale: the order is ` +
            `"${localOrder.status}" but the event expected "${expectedOld}" — ignoring`
        )
        return
      }
    }

    await this.supabase
      .from('orders')
      .update({
        status: localStatus,
        // A status event carries no remote timestamp, so the cursor is left
        // untouched — overwriting it with the local clock would make every
        // later full-order delivery look stale.
        easyorders_last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', localOrder.id)
  }

  // Get sync stats
  async getSyncStats(): Promise<EasyOrdersSyncStats> {
    const { data: config } = await this.supabase
      .from('easyorders_config')
      .select('*')
      .single()

    if (!config) {
      return {
        total_imported: 0,
        total_updated: 0,
        total_skipped: 0,
        last_sync_at: null,
        last_sync_status: null,
        last_error: null,
        errors: [],
      }
    }

    return {
      total_imported: config.total_imported_orders || 0,
      total_updated: config.total_updated_orders || 0,
      total_skipped: config.total_skipped_orders || 0,
      last_sync_at: config.last_sync_at,
      last_sync_status: config.last_sync_status,
      last_error: config.last_sync_error,
      errors: [],
    }
  }

  /**
   * Generate an order number that cannot collide.
   *
   * The previous format `EO-YYMMDD-####` had only 10 000 possible values
   * per day, so the birthday effect produced duplicate order numbers
   * (unique constraint `orders_order_number_key`). That collision aborted
   * the whole order import. The EasyOrders order id is used as a seed, so
   * the number is deterministic AND effectively unique.
   */
  private generateOrderNumber(seed?: string): string {
    const now = new Date()
    const year = now.getFullYear().toString().slice(-2)
    const month = (now.getMonth() + 1).toString().padStart(2, '0')
    const day = now.getDate().toString().padStart(2, '0')
    let suffix: string
    if (seed) {
      let hash = 0
      for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
      }
      suffix = hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 6)
    } else {
      suffix = Math.floor(Math.random() * 36 ** 6)
        .toString(36)
        .toUpperCase()
        .padStart(6, '0')
        .slice(0, 6)
    }
    return `EO-${year}${month}${day}-${suffix}`
  }

  private mapPaymentMethod(method: string): PaymentMethod {
    const methodMap: Record<string, PaymentMethod> = {
      'cod': 'cash_on_delivery',
      'cash': 'cash_on_delivery',
      'card': 'card',
      'credit_card': 'card',
      'bank_transfer': 'bank_transfer',
      'wallet': 'wallet',
    }
    return methodMap[method?.toLowerCase()] || 'cash_on_delivery'
  }

  /**
   * OFFICIAL API FACT: the EasyOrders Public API has NO endpoint to list
   * orders (GET /orders returns 404). Orders are delivered in real time via
   * Webhooks only. REST-based full/incremental import is therefore
   * impossible — this method verifies the saved key and reports the
   * webhook workflow instead of pretending to sync.
   */
  async verifySyncCapability(): Promise<{ verified: boolean; storeId: string | null; message: string }> {
    const result = await easyOrdersService.testConnection()
    if (!result.success) {
      return { verified: false, storeId: null, message: result.error || 'فشل التحقق من المفتاح' }
    }
    return {
      verified: true,
      storeId: result.store?.id ?? null,
      message: 'المفتاح يعمل بنجاح. الطلبات تصل تلقائياً عبر Webhooks — اربط رابط الـ Webhook في لوحة EasyOrders (Public API → Webhooks).',
    }
  }

  /**
   * Process webhook event (the ONLY way orders enter the system).
   *
   * Returns the outcome so callers (backfill, queue diagnostics) can report
   * accurate imported/skipped counts instead of assuming success.
   */
  async processWebhookEvent(
    eventType: string,
    payload: unknown
  ): Promise<SyncOutcome> {
    if (eventType === 'order-created') {
      const outcome = await this.handleOrderCreated(payload as EasyOrdersOrderCreatedPayload)
      await stampEasyOrdersSync(this.supabase, outcome.outcome)
      return outcome
    } else if (eventType === 'order-status-update') {
      await this.handleStatusUpdate(payload as EasyOrdersStatusUpdatePayload)
      await stampEasyOrdersSync(this.supabase, 'updated')
      return { outcome: 'updated' }
    } else {
      console.warn(`Unknown webhook event type: ${eventType}`)
      return { outcome: 'ignored' }
    }
  }
}

// Singleton instance
export const easyOrdersSyncService = new EasyOrdersSyncService()
