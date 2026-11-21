import { describe, it, expect, vi, afterEach } from 'vitest'
import { invalidateOverviewCache, previousWindow, normalizePreset } from './engine'

/**
 * The engine's date helpers and its cache.
 *
 * The cache is a performance device, not a correctness device: it must never
 * return a metric set for a DIFFERENT window, and it must be possible to
 * drop it after a write.
 */

afterEach(() => {
  invalidateOverviewCache()
  vi.restoreAllMocks()
})

describe('previousWindow', () => {
  it('returns the window immediately before, with the same length', () => {
    const prev = previousWindow('2026-10-22T00:00:00.000Z', '2026-11-21T00:00:00.000Z')
    expect(prev.from).toBeTruthy()
    expect(prev.to).toBeTruthy()
    const current = new Date('2026-11-21T00:00:00.000Z').getTime() - new Date('2026-10-22T00:00:00.000Z').getTime()
    const previous = new Date(prev.to!).getTime() - new Date(prev.from!).getTime()
    expect(previous).toBe(current)
  })

  it('has no previous window for an open range', () => {
    expect(previousWindow(null, null)).toEqual({ from: null, to: null })
  })

  it('has no previous window for a reversed range', () => {
    expect(previousWindow('2026-11-21T00:00:00.000Z', '2026-10-22T00:00:00.000Z')).toEqual({
      from: null,
      to: null,
    })
  })
})

describe('normalizePreset', () => {
  it('keeps a known preset', () => {
    expect(normalizePreset('last_30_days', false)).toBe('last_30_days')
  })

  it('falls back to this month for an unknown preset — never to "all time"', () => {
    expect(normalizePreset('last_120_days', false)).toBe('this_month')
    expect(normalizePreset(undefined, false)).toBe('this_month')
  })

  it('lets a custom range win', () => {
    expect(normalizePreset('last_30_days', true)).toBeNull()
  })
})

describe('invalidateOverviewCache', () => {
  it('is safe to call when nothing is cached', () => {
    expect(() => invalidateOverviewCache()).not.toThrow()
  })
})
