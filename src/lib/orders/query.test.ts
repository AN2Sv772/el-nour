import { describe, it, expect } from 'vitest'
import { calendarParts, BUSINESS_TIME_ZONE } from '@/lib/date-range'
import {
  resolveOrderFilters,
  applyOrderFilters,
  parsePagination,
  parseSort,
  sanitizeEmbeddedValue,
  escapeFilterValue,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  SHIPPING_STATUS_GROUPS,
  ORDER_SORT_COLUMNS,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
  type OrderFilters,
} from './query'

/**
 * A tiny PostgREST query-builder recorder. It captures every call so the
 * tests can assert on the filter expression that would be sent to Supabase
 * without needing a live database.
 */
function makeQuery() {
  const calls: { method: string; args: unknown[] }[] = []
  const query: any = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'calls') return calls
        return (...args: unknown[]) => {
          calls.push({ method: prop, args })
          return query
        }
      },
    }
  )
  return { query, calls }
}

function methods(calls: { method: string }[]) {
  return calls.map(c => c.method)
}

function findCall(calls: { method: string; args: unknown[] }[], method: string) {
  return calls.find(c => c.method === method)
}

describe('resolveOrderFilters', () => {
  it('trims the search term and treats an empty string as no search', () => {
    expect(resolveOrderFilters({ search: '   ' }).search).toBeNull()
    expect(resolveOrderFilters({ search: '  أحمد  ' }).search).toBe('أحمد')
    expect(resolveOrderFilters({}).search).toBeNull()
  })

  it('accepts only known order statuses', () => {
    expect(resolveOrderFilters({ status: 'shipped' }).status).toBe('shipped')
    expect(resolveOrderFilters({ status: 'not_a_status' }).status).toBeNull()
    expect(resolveOrderFilters({ status: 'shipped,delivered' }).status).toBeNull()
  })

  it('accepts only known payment statuses', () => {
    expect(resolveOrderFilters({ paymentStatus: 'paid' }).paymentStatus).toBe('paid')
    expect(resolveOrderFilters({ paymentStatus: 'hacked' }).paymentStatus).toBeNull()
  })

  it('expands a shipping phase into its status group', () => {
    expect(resolveOrderFilters({ shippingStatus: 'in_transit' }).shippingStatuses)
      .toEqual(['shipped', 'out_for_delivery'])
    expect(resolveOrderFilters({ shippingStatus: 'delivered' }).shippingStatuses)
      .toEqual(['delivered'])
    expect(resolveOrderFilters({ shippingStatus: 'unknown' }).shippingStatuses).toBeNull()
  })

  it('covers every order status in at least one shipping group', () => {
    const grouped = new Set(Object.values(SHIPPING_STATUS_GROUPS).flat())
    for (const status of ORDER_STATUSES) {
      expect(grouped.has(status)).toBe(true)
    }
  })

  it('resolves the date range through the shared engine', () => {
    const resolved = resolveOrderFilters({ dateRange: 'today' })
    expect(resolved.dateRange.preset).toBe('today')
    expect(resolved.dateRange.from).toBeTruthy()
    expect(resolved.dateRange.to).toBeTruthy()
  })

  it('auto-swaps a reversed custom range', () => {
    const resolved = resolveOrderFilters({ from: '2026-10-20', to: '2026-10-01' })
    // The bounds are UTC instants; the calendar day they represent must be
    // read in the business time zone (Cairo), not in UTC.
    const fromDay = calendarParts(new Date(resolved.dateRange.from!), BUSINESS_TIME_ZONE)
    const toDay = calendarParts(new Date(resolved.dateRange.to!), BUSINESS_TIME_ZONE)
    expect([fromDay.year, fromDay.month, fromDay.day]).toEqual([2026, 10, 1])
    expect([toDay.year, toDay.month, toDay.day]).toEqual([2026, 10, 20])
    expect(resolved.dateRange.from! < resolved.dateRange.to!).toBe(true)
  })

  it('falls back to the default preset for a malformed custom range', () => {
    // An unparseable custom date must not silently widen the filter to
    // "everything" — it falls back to the default preset instead.
    const resolved = resolveOrderFilters({ from: 'not-a-date', to: 'also-not' })
    expect(resolved.dateRange.preset).toBe('all')

    const withPreset = resolveOrderFilters({ dateRange: 'today', from: 'not-a-date' })
    expect(withPreset.dateRange.preset).toBe('today')
    expect(withPreset.dateRange.from).toBeTruthy()
  })

  it('leaves the range open for the "all" preset', () => {
    const resolved = resolveOrderFilters({ dateRange: 'all' })
    expect(resolved.dateRange.from).toBeNull()
    expect(resolved.dateRange.to).toBeNull()
  })
})

describe('escapeFilterValue / sanitizeEmbeddedValue', () => {
  it('removes quotes and backslashes (they would break the expression)', () => {
    expect(escapeFilterValue('a"b')).toBe('ab')
    expect(escapeFilterValue('a\\b')).toBe('ab')
  })

  it('neutralises the PostgREST logical operators', () => {
    expect(escapeFilterValue('a,b')).toBe('a b')
    expect(escapeFilterValue('a(b)')).toBe('a b')
    expect(escapeFilterValue('a,b(c)')).toBe('a b c')
  })

  it('cannot break out of the filter expression', () => {
    const injected = escapeFilterValue('x"),or=(id.eq.00000000-0000-0000-0000-000000000000)')
    expect(injected).not.toContain(',')
    expect(injected).not.toContain('(')
    expect(injected).not.toContain(')')
  })

  it('sanitises embedded values the same way', () => {
    expect(sanitizeEmbeddedValue('a,b')).toBe('a b')
    expect(sanitizeEmbeddedValue('a"b')).toBe('a b')
    expect(sanitizeEmbeddedValue('  a   b  ')).toBe('a b')
  })
})

describe('applyOrderFilters', () => {
  it('applies the date range as created_at bounds', () => {
    const { query, calls } = makeQuery()
    const resolved = resolveOrderFilters({ dateRange: 'today' })
    applyOrderFilters(query, resolved)
    expect(methods(calls)).toContain('gte')
    expect(methods(calls)).toContain('lte')
    expect(findCall(calls, 'gte')!.args[0]).toBe('created_at')
  })

  it('applies an exact status filter', () => {
    const { query, calls } = makeQuery()
    applyOrderFilters(query, resolveOrderFilters({ status: 'shipped' }))
    const eq = calls.filter(c => c.method === 'eq')
    expect(eq.some(c => c.args[0] === 'status' && c.args[1] === 'shipped')).toBe(true)
  })

  it('applies a shipping phase as an IN filter', () => {
    const { query, calls } = makeQuery()
    applyOrderFilters(query, resolveOrderFilters({ shippingStatus: 'in_transit' }))
    const inCall = findCall(calls, 'in')
    expect(inCall!.args[0]).toBe('status')
    expect(inCall!.args[1]).toEqual(['shipped', 'out_for_delivery'])
  })

  it('applies a status AND a shipping phase together (honest AND semantics)', () => {
    const { query, calls } = makeQuery()
    applyOrderFilters(
      query,
      resolveOrderFilters({ status: 'pending', shippingStatus: 'delivered' })
    )
    const eqStatus = calls.find(c => c.method === 'eq' && c.args[0] === 'status')
    const inStatus = calls.find(c => c.method === 'in' && c.args[0] === 'status')
    // Neither filter is silently dropped — a contradictory pair simply
    // matches no rows.
    expect(eqStatus!.args[1]).toBe('pending')
    expect(inStatus!.args[1]).toEqual(['delivered'])
  })

  it('searches the order fields with a single OR expression', () => {
    const { query, calls } = makeQuery()
    applyOrderFilters(query, resolveOrderFilters({ search: '1005' }))
    const orCall = findCall(calls, 'or')
    expect(orCall).toBeDefined()
    const expr = String(orCall!.args[0])
    expect(expr).toContain('order_number.ilike')
    expect(expr).toContain('tracking_number.ilike')
    expect(expr).toContain('shipping_address->>name.ilike')
    expect(expr).toContain('shipping_address->>phone.ilike')
    expect(expr).toContain('shipping_address->>city.ilike')
  })

  it('adds an exact id branch only when the search term is a UUID', () => {
    const { query, calls } = makeQuery()
    applyOrderFilters(
      query,
      resolveOrderFilters({ search: '6735df05-22ec-4d47-8af0-a1d22d914c00' })
    )
    const expr = String(findCall(calls, 'or')!.args[0])
    expect(expr).toContain('id.eq.6735df05-22ec-4d47-8af0-a1d22d914c00')
  })

  it('does not treat a plain number as an id', () => {
    const { query, calls } = makeQuery()
    applyOrderFilters(query, resolveOrderFilters({ search: '1005' }))
    const expr = String(findCall(calls, 'or')!.args[0])
    expect(expr).not.toContain('id.eq.')
  })

  it('folds the product branch into the search as a top-level id list', () => {
    const { query, calls } = makeQuery()
    const resolved = resolveOrderFilters({ search: 'بخاخ' })
    applyOrderFilters(query, resolved, {
      productMatchIds: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
    })
    const expr = String(findCall(calls, 'or')!.args[0])
    expect(expr).toContain('id.in.(11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222)')
  })

  it('sanitises a search term that tries to inject a second OR', () => {
    const { query, calls } = makeQuery()
    applyOrderFilters(query, resolveOrderFilters({ search: 'x"),or(status.eq.paid' }))
    const expr = String(findCall(calls, 'or')!.args[0])
    // The injected parentheses are neutralised, so no nested logic tree can
    // be smuggled into the expression.
    expect(expr).not.toMatch(/or\(/)
    expect(expr).not.toMatch(/\),/)
    // ...and the term survives as inert text inside the quoted pattern.
    expect(expr).toContain('order_number.ilike')
  })

  it('filters by product through the embedded relation', () => {
    const { query, calls } = makeQuery()
    applyOrderFilters(query, resolveOrderFilters({ productId: 'abc-123' }))
    const eq = calls.find(c => c.method === 'eq' && c.args[0] === 'items.product_id')
    expect(eq!.args[1]).toBe('abc-123')
  })

  it('filters by customer', () => {
    const { query, calls } = makeQuery()
    applyOrderFilters(query, resolveOrderFilters({ customerId: 'cust-1' }))
    const eq = calls.find(c => c.method === 'eq' && c.args[0] === 'customer_id')
    expect(eq!.args[1]).toBe('cust-1')
  })

  it('combines several filters — every one is applied', () => {
    const { query, calls } = makeQuery()
    const filters: OrderFilters = {
      search: '1005',
      status: 'shipped',
      paymentStatus: 'paid',
      customerId: 'cust-1',
      productId: 'prod-1',
      dateRange: 'month',
    }
    applyOrderFilters(query, resolveOrderFilters(filters))
    const m = methods(calls)
    expect(m).toContain('gte')
    expect(m).toContain('lte')
    expect(m).toContain('or')
    const eqs = calls.filter(c => c.method === 'eq').map(c => c.args[0])
    expect(eqs).toContain('status')
    expect(eqs).toContain('payment_status')
    expect(eqs).toContain('customer_id')
    expect(eqs).toContain('items.product_id')
  })
})

describe('parsePagination', () => {
  it('defaults to page 1 with 20 rows', () => {
    const p = parsePagination(new URLSearchParams())
    expect(p).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE, offset: 0 })
  })

  it('computes the offset', () => {
    const p = parsePagination(new URLSearchParams('page=3&pageSize=25'))
    expect(p).toEqual({ page: 3, pageSize: 25, offset: 50 })
  })

  it('caps the page size', () => {
    const p = parsePagination(new URLSearchParams('pageSize=10000'))
    expect(p).toMatchObject({ pageSize: MAX_PAGE_SIZE })
  })

  it('rejects a page number below 1', () => {
    expect(parsePagination(new URLSearchParams('page=0'))).toHaveProperty('error')
    expect(parsePagination(new URLSearchParams('page=-5'))).toHaveProperty('error')
  })

  it('rejects a non-numeric page or page size', () => {
    expect(parsePagination(new URLSearchParams('page=abc'))).toHaveProperty('error')
    expect(parsePagination(new URLSearchParams('pageSize=abc'))).toHaveProperty('error')
    expect(parsePagination(new URLSearchParams('pageSize=0'))).toHaveProperty('error')
  })
})

describe('parseSort', () => {
  it('defaults to created_at descending', () => {
    expect(parseSort(new URLSearchParams())).toEqual({ sortBy: 'created_at', ascending: false })
  })

  it('accepts a known column', () => {
    expect(parseSort(new URLSearchParams('sortBy=total_amount&sortOrder=asc'))).toEqual({
      sortBy: 'total_amount',
      ascending: true,
    })
  })

  it('falls back to created_at for an unknown column', () => {
    const result = parseSort(new URLSearchParams('sortBy=;drop table orders;--'))
    expect(result.sortBy).toBe('created_at')
  })

  it('only ever returns an allow-listed column', () => {
    for (const key of Object.keys(ORDER_SORT_COLUMNS)) {
      expect(parseSort(new URLSearchParams(`sortBy=${key}`)).sortBy).toBe(key)
    }
    expect(Object.keys(ORDER_SORT_COLUMNS)).not.toContain('internal_notes')
  })
})
