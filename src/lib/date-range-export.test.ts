/**
 * Regression test for F-017 — the Excel export must use the SAME date
 * boundaries as the orders list.
 *
 * BEFORE: the export compared the raw filter strings
 * (`2026-11-01` → `2026-11-01T00:00:00.000Z`), while the list used the
 * Africa/Cairo day boundaries (`2026-10-31T22:00:00.000Z` …). The export
 * therefore missed the three orders created between 00:00 and 02:00 Cairo
 * time on 2026-11-01 (503 exported rows vs 506 in the list).
 *
 * AFTER: both read `resolveDateRange`, so one filter can only mean one
 * answer — and an unparseable bound fails closed instead of widening the
 * export to "everything".
 */
import { describe, it, expect } from 'vitest'
import { resolveDateRange, businessDateString } from './date-range'

const NOW = new Date('2026-11-21T12:00:00.000Z')

/** Mirror of the export route's normaliser (see api/export/excel/route.ts). */
function normalizeExportDate(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return undefined
  const raw = String(value).trim()
  if (!raw) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const probe = new Date(`${raw}T00:00:00Z`)
    return Number.isNaN(probe.getTime()) ? null : raw
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return businessDateString(parsed)
}

describe('F-017 — export date boundaries', () => {
  it('expands a day-only filter to the Cairo day, not to raw UTC midnight', () => {
    const range = resolveDateRange({ dateFrom: '2026-11-01', dateTo: '2026-11-21' }, NOW)

    // Cairo is UTC+2 in November → 00:00 Cairo = 22:00 UTC the day before.
    expect(range.from).toBe('2026-10-31T22:00:00.000Z')
    // 23:59:59.999 Cairo = 21:59:59.999 UTC.
    expect(range.to).toBe('2026-11-21T21:59:59.999Z')
  })

  it('never produces the raw UTC bounds the export used before', () => {
    const range = resolveDateRange({ dateFrom: '2026-11-01', dateTo: '2026-11-21' }, NOW)

    expect(range.from).not.toBe('2026-11-01T00:00:00.000Z')
    expect(range.to).not.toBe('2026-11-21T23:59:59.999Z')
  })

  it('is the same engine the orders list uses — one filter, one answer', () => {
    // The list passes `dateFrom`/`dateTo` too (legacy aliases), so both
    // routes must produce byte-identical bounds.
    const listStyle = resolveDateRange({ dateFrom: '2026-11-01', dateTo: '2026-11-21' }, NOW)
    const exportStyle = resolveDateRange({ from: '2026-11-01', to: '2026-11-21' }, NOW)

    expect(exportStyle.from).toBe(listStyle.from)
    expect(exportStyle.to).toBe(listStyle.to)
  })

  describe('filter normalisation (fail closed)', () => {
    it('keeps a plain business day as it is', () => {
      expect(normalizeExportDate('2026-11-01')).toBe('2026-11-01')
    })

    it('maps an ISO instant to the Cairo day that contains it', () => {
      // 23:00 UTC on 2026-11-01 = 01:00 Cairo on 2026-11-02.
      expect(normalizeExportDate('2026-11-01T23:00:00.000Z')).toBe('2026-11-02')
      // 12:30 UTC on 2026-11-01 = 14:30 Cairo on 2026-11-01.
      expect(normalizeExportDate('2026-11-01T12:30:00.000Z')).toBe('2026-11-01')
    })

    it('reports an unparseable bound instead of dropping the filter', () => {
      expect(normalizeExportDate('not-a-date')).toBeNull()
      expect(normalizeExportDate('2026-13-45')).toBeNull()
    })

    it('reports "no filter" for empty values', () => {
      expect(normalizeExportDate(undefined)).toBeUndefined()
      expect(normalizeExportDate(null)).toBeUndefined()
      expect(normalizeExportDate('   ')).toBeUndefined()
    })

    it('an invalid bound never turns into an unbounded export', () => {
      const normalized = normalizeExportDate('not-a-date')
      // The route answers 400 for this value — it must never reach
      // resolveDateRange, which would fall back to the "all" preset.
      expect(normalized).toBeNull()
    })
  })
})
