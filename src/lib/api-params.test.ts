import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_TOP_LIMIT,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  MAX_TOP_LIMIT,
  isUuid,
  parseBoundedInt,
  parseDateParam,
  parsePageParams,
  parseSortColumn,
  parseSortOrder,
  sanitizeSearchTerm,
} from '@/lib/api-params'
import { isRangeNotSatisfiable } from '@/lib/supabase/paginate'

describe('sanitizeSearchTerm', () => {
  it('keeps a normal search term untouched', () => {
    expect(sanitizeSearchTerm('أحمد محمد')).toBe('أحمد محمد')
    expect(sanitizeSearchTerm('01012345678')).toBe('01012345678')
    expect(sanitizeSearchTerm('ali@example.com')).toBe('ali@example.com')
  })

  it('removes the PostgREST filter metacharacters', () => {
    const out = sanitizeSearchTerm('x"),or=(id.eq.00000000-0000-0000-0000-000000000000)')
    expect(out).not.toContain(',')
    expect(out).not.toContain('(')
    expect(out).not.toContain(')')
    expect(out).not.toContain('[')
    expect(out).not.toContain(']')
  })

  it('removes double quotes (they delimit a PostgREST value)', () => {
    expect(sanitizeSearchTerm('a"b')).toBe('ab')
  })

  it('neutralises a SQL-style injection attempt', () => {
    const out = sanitizeSearchTerm("' OR 1=1--") ?? ''
    expect(out).not.toContain("'")
    expect(out).not.toContain('=')
    expect(out).not.toContain('--')
    expect(out.toLowerCase()).not.toContain('or 1=1')
  })

  it('neutralises a union-select attempt', () => {
    const out = sanitizeSearchTerm("x' UNION SELECT null--") ?? ''
    expect(out).not.toContain("'")
    expect(out).not.toContain('--')
    expect(out.toLowerCase()).not.toContain('union select')
  })

  it('keeps a legitimate apostrophe in a name', () => {
    expect(sanitizeSearchTerm("O'Brien")).toBe("O'Brien")
  })

  it('caps the length of a search term', () => {
    const out = sanitizeSearchTerm('a'.repeat(500)) ?? ''
    expect(out.length).toBe(MAX_SEARCH_LENGTH)
  })

  it('returns null for an empty term', () => {
    expect(sanitizeSearchTerm('')).toBeNull()
    expect(sanitizeSearchTerm('   ')).toBeNull()
    expect(sanitizeSearchTerm(null)).toBeNull()
    expect(sanitizeSearchTerm(undefined)).toBeNull()
  })
})

describe('parseDateParam', () => {
  it('accepts a real calendar date', () => {
    expect(parseDateParam('2026-11-20')).toEqual({ ok: true, value: '2026-11-20' })
  })

  it('treats an empty value as "not provided"', () => {
    expect(parseDateParam(null)).toEqual({ ok: true, value: null })
    expect(parseDateParam('')).toEqual({ ok: true, value: null })
  })

  it('rejects a malformed date instead of letting Postgres fail', () => {
    const result = parseDateParam('not-a-date')
    expect(result.ok).toBe(false)
  })

  it('rejects an impossible calendar date', () => {
    expect(parseDateParam('2026-02-30').ok).toBe(false)
  })

  it('rejects a datetime string (the contract is a calendar day)', () => {
    expect(parseDateParam('2026-11-20T10:00:00Z').ok).toBe(false)
  })
})

describe('parseBoundedInt', () => {
  it('falls back to the default for an empty value', () => {
    expect(parseBoundedInt(null, { min: 1, max: 10, defaultValue: 5 })).toEqual({ ok: true, value: 5 })
  })

  it('rejects a value below the minimum', () => {
    expect(parseBoundedInt('-1', { min: 1, max: 10, defaultValue: 5 }).ok).toBe(false)
  })

  it('rejects a value above the maximum', () => {
    expect(parseBoundedInt('999999', { min: 1, max: 100, defaultValue: 5 }).ok).toBe(false)
  })

  it('rejects a non-integer', () => {
    expect(parseBoundedInt('abc', { min: 1, max: 10, defaultValue: 5 }).ok).toBe(false)
    expect(parseBoundedInt('1.5', { min: 1, max: 10, defaultValue: 5 }).ok).toBe(false)
  })

  it('can clamp instead of rejecting', () => {
    expect(parseBoundedInt('999999', { min: 1, max: 100, defaultValue: 5, clamp: true }))
      .toEqual({ ok: true, value: 100 })
  })
})

describe('parsePageParams', () => {
  it('uses the documented defaults', () => {
    const params = new URLSearchParams()
    expect(parsePageParams(params)).toEqual({
      ok: true,
      value: { page: 1, pageSize: DEFAULT_PAGE_SIZE, offset: 0 },
    })
  })

  it('caps the page size (no unbounded pageSize)', () => {
    const params = new URLSearchParams('pageSize=5000')
    const result = parsePageParams(params)
    expect(result.ok).toBe(false)
  })

  it('rejects page 0 and negative pages', () => {
    expect(parsePageParams(new URLSearchParams('page=0')).ok).toBe(false)
    expect(parsePageParams(new URLSearchParams('page=-3')).ok).toBe(false)
  })

  it('computes the offset', () => {
    const result = parsePageParams(new URLSearchParams('page=3&pageSize=10'))
    expect(result).toEqual({ ok: true, value: { page: 3, pageSize: 10, offset: 20 } })
  })

  it('exposes the maximum page size', () => {
    expect(MAX_PAGE_SIZE).toBe(200)
  })
})

describe('parseSortColumn / parseSortOrder', () => {
  const allowed = { created_at: 'created_at', name: 'name' } as const

  it('accepts an allowed column', () => {
    expect(parseSortColumn('name', allowed, 'created_at')).toEqual({ ok: true, value: 'name' })
  })

  it('rejects an unknown column instead of letting Postgres fail', () => {
    const result = parseSortColumn('nonexistent_column', allowed, 'created_at')
    expect(result.ok).toBe(false)
  })

  it('rejects a SQL fragment as a sort column', () => {
    expect(parseSortColumn(';drop table', allowed, 'created_at').ok).toBe(false)
  })

  it('uses the fallback for an empty sort column', () => {
    expect(parseSortColumn(null, allowed, 'created_at')).toEqual({ ok: true, value: 'created_at' })
  })

  it('reads the direction', () => {
    expect(parseSortOrder('asc')).toBe(true)
    expect(parseSortOrder('ASC')).toBe(true)
    expect(parseSortOrder('desc')).toBe(false)
    expect(parseSortOrder(null)).toBe(false)
  })
})

describe('isUuid', () => {
  it('accepts a canonical uuid', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid("' OR 1=1--")).toBe(false)
    expect(isUuid(null)).toBe(false)
  })
})

describe('isRangeNotSatisfiable', () => {
  it('detects PGRST103', () => {
    expect(isRangeNotSatisfiable({ code: 'PGRST103', message: 'Requested range not satisfiable' })).toBe(true)
  })

  it('does not match other errors', () => {
    expect(isRangeNotSatisfiable({ code: '42703', message: 'column does not exist' })).toBe(false)
    expect(isRangeNotSatisfiable(null)).toBe(false)
    expect(isRangeNotSatisfiable(undefined)).toBe(false)
  })
})

describe('top-N limits', () => {
  it('bounds the "top products" limit', () => {
    expect(MAX_TOP_LIMIT).toBe(100)
    expect(DEFAULT_TOP_LIMIT).toBe(5)
  })
})
