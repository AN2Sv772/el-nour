/**
 * Regression tests for the EasyOrders import dedup path.
 *
 * Historical bug: the dedup pre-check did not mirror the unique index
 * `idx_orders (easyorders_order_id, easyorders_store_id)` and silently
 * swallowed lookup errors. A transient read failure therefore let the
 * insert run and fail with a spurious 23505, inflating the backfill's
 * `failed` counter (629 phantom failures in production).
 *
 * These tests pin the fixed contract:
 *   1. the lookup filters on BOTH easyorders_order_id and easyorders_store_id
 *   2. a lookup error is surfaced (throws) instead of being swallowed
 *   3. an existing order short-circuits the import (idempotency)
 *   4. a 23505 on insert is reported as "skipped", not as a failure
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Filter = { column: string; value: unknown }
type OrderRow = { id: string; easyorders_order_id: string; easyorders_store_id: string }
type InsertedOrder = { id: string }

/** Records every filter applied so we can assert on the lookup shape. */
const appliedFilters: Filter[] = []

const state = {
  /** Rows the mocked `orders` table contains. */
  orderRows: [] as { id: string; easyorders_order_id: string; easyorders_store_id: string }[],
  /** Error returned by the dedup SELECT. */
  lookupError: null as { message: string; code?: string } | null,
  /** Error returned by the order INSERT. */
  insertError: null as { message: string; code?: string } | null,
  /** Rows returned by the order INSERT. */
  insertedOrder: null as InsertedOrder | null,
  /** Every table touched, in order. */
  calls: [] as string[],
  /** The payload of the last row inserted into `orders`. */
  lastOrderInsert: null as null | Record<string, unknown>,
  /** Error returned by the `order_items` INSERT. */
  itemsInsertError: null as { message: string; code?: string } | null,
  /** Ids of orders that were deleted (compensating rollback). */
  deletedOrderIds: [] as string[],
}

function matchesRow(row: { easyorders_order_id: string; easyorders_store_id: string }, filters: Filter[]) {
  return filters.every((f) => {
    if (f.column === 'easyorders_order_id') return row.easyorders_order_id === f.value
    if (f.column === 'easyorders_store_id') return row.easyorders_store_id === f.value
    return true
  })
}

function makeQuery(table: string) {
  const filters: Filter[] = []
  const query: Record<string, unknown> = {}

  query.select = vi.fn((_cols?: string) => {
    state.calls.push(`${table}.select`)
    return query
  })
  query.eq = vi.fn((column: string, value: unknown) => {
    filters.push({ column, value })
    appliedFilters.push({ column, value })
    return query
  })
  query.limit = vi.fn(() => query)
  query.order = vi.fn(() => query)
  query.insert = vi.fn((payload: Record<string, unknown>) => {
    state.calls.push(`${table}.insert`)
    if (table === 'orders') state.lastOrderInsert = payload
    const built: Record<string, unknown> = {
      ...query,
      select: vi.fn(() => built),
      single: vi.fn(async () => {
        if (table === 'orders') {
          if (state.insertError) return { data: null, error: state.insertError }
          return { data: state.insertedOrder, error: null }
        }
        if (table === 'customers') return { data: { id: 'customer-id' }, error: null }
        if (table === 'products') return { data: { id: 'product-id' }, error: null }
        return { data: null, error: null }
      }),
    }
    void payload
    return built
  })
  // The `order_items` insert is awaited directly (`const { error } = await
  // ...insert(...)`), so the mock must resolve to `{ data, error }`.
  query.then = (resolve: (v: { data: null; error: unknown }) => unknown, reject: (e: unknown) => unknown) => {
    if (table === 'order_items' && state.itemsInsertError) {
      return Promise.resolve({ data: null, error: state.itemsInsertError }).then(resolve, reject)
    }
    return Promise.resolve({ data: null, error: null }).then(resolve, reject)
  }
  query.delete = vi.fn(() => {
    state.calls.push(`${table}.delete`)
    return {
      ...query,
      eq: vi.fn((column: string, value: unknown) => {
        if (table === 'orders' && column === 'id') state.deletedOrderIds.push(String(value))
        return {
          ...query,
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve, reject),
        }
      }),
    }
  })
  query.single = vi.fn(async () => {
    state.calls.push(`${table}.single`)
    if (table === 'orders') {
      if (state.lookupError) return { data: null, error: state.lookupError }
      const row = state.orderRows.find((r) => matchesRow(r, filters))
      return { data: row ?? null, error: null }
    }
    return { data: null, error: null }
  })
  query.maybeSingle = vi.fn(async () => {
    state.calls.push(`${table}.maybeSingle`)
    if (table === 'orders') {
      if (state.lookupError) return { data: null, error: state.lookupError }
      const row = state.orderRows.find((r) => matchesRow(r, filters))
      return { data: row ?? null, error: null }
    }
    return { data: null, error: null }
  })
  // NOTE: deliberately NOT thenable. Real PostgREST builders are, but a
  // thenable mock makes `await builder.insert(...)` recurse forever.
  return query
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn((table: string) => makeQuery(table)),
  })),
}))

vi.mock('@/lib/easyorders/service', () => ({
  easyOrdersService: {
    testConnection: vi.fn(),
    parseWebhookPayload: vi.fn(),
    parseEvent: vi.fn(),
    verifyWebhookSecret: vi.fn(),
  },
}))

import { easyOrdersSyncService } from '@/lib/easyorders/sync'

const STORE = '3fb15a96-d8ec-43cf-bbcf-4e5711d37f43'

function orderPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-abc-123',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    store_id: STORE,
    cost: 100,
    shipping_cost: 0,
    total_cost: 100,
    status: 'pending',
    full_name: 'عميل اختبار',
    phone: '01000000000',
    government: 'القاهرة',
    address: 'عنوان اختبار',
    payment_method: 'cod',
    cart_items: [
      {
        id: 'item-1',
        product_id: 'prod-1',
        variant_id: null,
        store_id: STORE,
        price: 100,
        quantity: 1,
        product: { id: 'prod-1', name: 'منتج', price: 100, sku: 'SKU-1' },
        variant: null,
      },
    ],
    ...overrides,
  }
}

describe('EasyOrders import dedup', () => {
  beforeEach(() => {
    appliedFilters.length = 0
    state.orderRows = []
    state.lookupError = null
    state.insertError = null
    state.insertedOrder = { id: 'new-order-id' }
    state.calls = []
    state.lastOrderInsert = null
    state.itemsInsertError = null
    state.deletedOrderIds = []
    vi.clearAllMocks()
  })

  it('reports "created" for a brand-new order', async () => {
    const result = await easyOrdersSyncService.processWebhookEvent('order-created', orderPayload())
    expect(result.outcome).toBe('created')
    expect(result.orderId).toBe('new-order-id')
  })

  it('is idempotent — an already-imported order is skipped, not re-created', async () => {
    state.orderRows = [
      { id: 'existing-id', easyorders_order_id: 'order-abc-123', easyorders_store_id: STORE },
    ]
    const result = await easyOrdersSyncService.processWebhookEvent('order-created', orderPayload())
    expect(result.outcome).toBe('skipped')
    expect(result.orderId).toBe('existing-id')
    expect(state.calls).not.toContain('orders.insert')
  })

  it('surfaces a lookup error instead of swallowing it into a duplicate-key failure', async () => {
    state.lookupError = { message: 'connection reset', code: 'PGRST000' }
    await expect(
      easyOrdersSyncService.processWebhookEvent('order-created', orderPayload())
    ).rejects.toThrow('connection reset')
    // The insert must NOT have run — that is what produced the 629 phantom 23505s.
    expect(state.calls).not.toContain('orders.insert')
  })

  it('treats a 23505 on insert as a skip, not a failure', async () => {
    state.insertError = { message: 'duplicate key value violates unique constraint "idx_orders"', code: '23505' }
    state.orderRows = [
      { id: 'raced-order-id', easyorders_order_id: 'order-abc-123', easyorders_store_id: STORE },
    ]
    const result = await easyOrdersSyncService.processWebhookEvent('order-created', orderPayload())
    expect(result.outcome).toBe('skipped')
    expect(result.orderId).toBe('raced-order-id')
  })

  it('rethrows a non-duplicate insert error', async () => {
    state.insertError = { message: 'null value violates not-null constraint', code: '23502' }
    await expect(
      easyOrdersSyncService.processWebhookEvent('order-created', orderPayload())
    ).rejects.toThrow('not-null constraint')
  })

  it('matches on the SAME column set as the unique index (order id + store id)', async () => {
    await easyOrdersSyncService.processWebhookEvent('order-created', orderPayload())

    const orderIdFilters = appliedFilters.filter((f) => f.column === 'easyorders_order_id')
    const storeIdFilters = appliedFilters.filter((f) => f.column === 'easyorders_store_id')

    expect(orderIdFilters.length).toBeGreaterThan(0)
    expect(orderIdFilters.some((f) => f.value === 'order-abc-123')).toBe(true)

    // The unique index is (easyorders_order_id, easyorders_store_id) — the
    // lookup MUST filter on the store too, otherwise it misses rows.
    expect(storeIdFilters.length).toBeGreaterThan(0)
    expect(storeIdFilters.some((f) => f.value === STORE)).toBe(true)
  })

  it('coerces a missing price/quantity instead of writing a NULL subtotal', async () => {
    // A cart item without `price` used to yield a NaN subtotal → NULL →
    // 23502 not-null violation → the order was silently lost. The mocked
    // insert captures the payload so we can assert the totals are finite.
    const payload = orderPayload()
    // @ts-expect-error — deliberately simulating a malformed EasyOrders payload
    delete payload.cart_items[0].price
    // @ts-expect-error — deliberately simulating a malformed EasyOrders payload
    delete payload.cart_items[0].quantity

    const result = await easyOrdersSyncService.processWebhookEvent('order-created', payload)

    expect(result.outcome).toBe('created')
    const inserted = state.lastOrderInsert
    expect(inserted).toBeTruthy()
    expect(Number.isFinite(inserted!.subtotal)).toBe(true)
    expect(Number.isFinite(inserted!.total_amount)).toBe(true)
    expect(inserted!.subtotal).toBe(0)
    expect(inserted!.total_amount).toBe(0)
    const firstItem = (inserted!.items as { quantity: number; unit_price: number; total_price: number }[])[0]
    expect(Number.isFinite(firstItem.unit_price)).toBe(true)
    expect(Number.isFinite(firstItem.total_price)).toBe(true)
    expect(firstItem.quantity).toBe(1)
  })

  it('derives a collision-free order number from the EasyOrders order id', async () => {
    // `EO-YYMMDD-####` had only 10 000 values per day and collided
    // (orders_order_number_key), which aborted the whole import.
    const lastInsert = (): Record<string, unknown> | null => state.lastOrderInsert

    await easyOrdersSyncService.processWebhookEvent('order-created', orderPayload({ id: 'order-abc-123' }))
    const first = lastInsert()?.order_number as string
    expect(first).toMatch(/^EO-\d{6}-[0-9A-Z]{6}$/)

    state.lastOrderInsert = null
    await easyOrdersSyncService.processWebhookEvent('order-created', orderPayload({ id: 'order-abc-123' }))
    expect(lastInsert()?.order_number).toBe(first) // deterministic

    state.lastOrderInsert = null
    await easyOrdersSyncService.processWebhookEvent('order-created', orderPayload({ id: 'a-different-order' }))
    expect(lastInsert()?.order_number).not.toBe(first)
  })

  it('rolls the order row back when the line-item insert fails', async () => {
    // Without the compensating rollback, a failed `order_items` insert left
    // an order with no line items and no automation log — unrepairable,
    // because the unique index rejected every retry.
    state.itemsInsertError = { message: 'items insert exploded', code: '23503' }

    await expect(
      easyOrdersSyncService.processWebhookEvent('order-created', orderPayload({ id: 'order-items-fail' }))
    ).rejects.toThrow()

    expect(state.deletedOrderIds).toContain('new-order-id')
    expect(state.calls).toContain('orders.delete')
  })
})
