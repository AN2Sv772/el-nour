import { describe, it, expect } from 'vitest'
import {
  BUSINESS_TIME_ZONE,
  addDays,
  businessDateString,
  calendarParts,
  endOfBusinessDay,
  getPresetRange,
  parseDateOnly,
  resolveDateRange,
  startOfBusinessDay,
  timezoneOffsetMinutes,
  zonedTimeToUtc,
} from '@/lib/date-range'

describe('business timezone primitives', () => {
  it('uses Africa/Cairo as the business timezone', () => {
    expect(BUSINESS_TIME_ZONE).toBe('Africa/Cairo')
  })

  it('reads the wall clock in Cairo, not in UTC', () => {
    // 22:30 UTC on 19 Nov is already 00:30 on 20 Nov in Cairo (UTC+2).
    const instant = new Date('2026-11-19T22:30:00.000Z')
    const parts = calendarParts(instant)
    expect(parts.year).toBe(2026)
    expect(parts.month).toBe(11)
    expect(parts.day).toBe(20)
    expect(parts.hour).toBe(0)
    expect(parts.minute).toBe(30)
  })

  it('reports the Cairo UTC offset', () => {
    // Egypt is UTC+2 in winter (DST ends in late October) and UTC+3 in summer.
    expect(timezoneOffsetMinutes(new Date('2026-11-19T12:00:00.000Z'))).toBe(120)
    expect(timezoneOffsetMinutes(new Date('2026-07-19T12:00:00.000Z'))).toBe(180)
  })

  it('round-trips a zoned time through UTC', () => {
    const utc = zonedTimeToUtc(2026, 11, 19, 13, 45, 30, 0)
    expect(utc.toISOString()).toBe('2026-11-19T11:45:30.000Z')
    const back = calendarParts(utc)
    expect(back).toMatchObject({ year: 2026, month: 11, day: 19, hour: 13, minute: 45, second: 30 })
  })

  it('computes inclusive business-day bounds', () => {
    const instant = new Date('2026-11-19T12:00:00.000Z')
    expect(startOfBusinessDay(instant).toISOString()).toBe('2026-11-18T22:00:00.000Z')
    expect(endOfBusinessDay(instant).toISOString()).toBe('2026-11-19T21:59:59.999Z')
  })

  it('does calendar-safe day arithmetic across a DST change', () => {
    // DST ended in Egypt on 29 October 2026 (UTC+3 → UTC+2).
    const before = addDays(2026, 10, 28, 1)
    expect(before).toEqual({ year: 2026, month: 10, day: 29 })
    const after = addDays(2026, 10, 30, 1)
    expect(after).toEqual({ year: 2026, month: 10, day: 31 })
  })

  it('formats the business date string', () => {
    expect(businessDateString(new Date('2026-11-19T22:30:00.000Z'))).toBe('2026-11-20')
  })

  it('validates date-only strings', () => {
    expect(parseDateOnly('2026-11-19')).toEqual({ year: 2026, month: 11, day: 19 })
    expect(parseDateOnly('2026-02-30')).toBeNull()
    expect(parseDateOnly('19-11-2026')).toBeNull()
    expect(parseDateOnly('')).toBeNull()
  })
})

describe('preset ranges', () => {
  // A fixed "now" so the tests are deterministic.
  const now = new Date('2026-11-19T12:00:00.000Z') // 14:00 Cairo, Thursday

  it('resolves today to the Cairo business day', () => {
    const range = getPresetRange('today', now)
    expect(range.from).toBe('2026-11-18T22:00:00.000Z')
    expect(range.to).toBe('2026-11-19T21:59:59.999Z')
  })

  it('resolves yesterday to the previous Cairo business day', () => {
    const range = getPresetRange('yesterday', now)
    expect(range.from).toBe('2026-11-17T22:00:00.000Z')
    expect(range.to).toBe('2026-11-18T21:59:59.999Z')
  })

  it('starts the week on Sunday', () => {
    // 19 Nov 2026 is a Thursday → the week starts Sunday 15 Nov.
    const range = getPresetRange('this_week', now)
    expect(range.from).toBe('2026-11-14T22:00:00.000Z')
    expect(range.to).toBe('2026-11-19T21:59:59.999Z')
  })

  it('resolves last week to the previous Sunday–Saturday', () => {
    const range = getPresetRange('last_week', now)
    expect(range.from).toBe('2026-11-07T22:00:00.000Z')
    expect(range.to).toBe('2026-11-14T21:59:59.999Z')
  })

  it('resolves this month and last month', () => {
    const thisMonth = getPresetRange('this_month', now)
    expect(thisMonth.from).toBe('2026-10-31T22:00:00.000Z') // 1 Nov Cairo
    expect(thisMonth.to).toBe('2026-11-19T21:59:59.999Z')

    const lastMonth = getPresetRange('last_month', now)
    // 1 Oct 2026 is still inside Egyptian DST (UTC+3).
    expect(lastMonth.from).toBe('2026-09-30T21:00:00.000Z')
    expect(lastMonth.to).toBe('2026-10-31T21:59:59.999Z') // 31 Oct Cairo (UTC+2)
  })

  it('resolves rolling windows', () => {
    expect(getPresetRange('last_7_days', now).from).toBe('2026-11-12T22:00:00.000Z')
    // 20 Oct 2026 is still inside Egyptian DST (UTC+3), so the boundary is
    // one hour earlier in UTC than the November ones.
    expect(getPresetRange('last_30_days', now).from).toBe('2026-10-20T21:00:00.000Z')
    expect(getPresetRange('this_year', now).from).toBe('2025-12-31T22:00:00.000Z')
  })

  it('returns no bounds for "all"', () => {
    expect(getPresetRange('all', now)).toEqual({ from: null, to: null })
  })

  it('never produces an inverted range', () => {
    for (const preset of ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_7_days', 'last_30_days', 'this_year']) {
      const range = getPresetRange(preset, now)
      expect(Date.parse(range.from!)).toBeLessThan(Date.parse(range.to!))
    }
  })
})

describe('resolveDateRange', () => {
  const now = new Date('2026-11-19T12:00:00.000Z')

  it('accepts a preset', () => {
    const range = resolveDateRange({ dateRange: 'today' }, now)
    expect(range.preset).toBe('today')
    expect(range.from).toBe('2026-11-18T22:00:00.000Z')
  })

  it('accepts a custom inclusive range and includes the whole end day', () => {
    const range = resolveDateRange({ from: '2026-11-01', to: '2026-11-19' }, now)
    expect(range.preset).toBe('custom')
    expect(range.from).toBe('2026-10-31T22:00:00.000Z')
    // The end bound is the END of 19 Nov Cairo — not midnight, which is what
    // silently dropped same-day orders before.
    expect(range.to).toBe('2026-11-19T21:59:59.999Z')
  })

  it('lets custom dates override the preset', () => {
    const range = resolveDateRange({ dateRange: 'today', from: '2026-01-01', to: '2026-01-31' }, now)
    expect(range.preset).toBe('custom')
    expect(range.from).toBe('2025-12-31T22:00:00.000Z')
  })

  it('swaps reversed custom dates', () => {
    const range = resolveDateRange({ from: '2026-11-19', to: '2026-11-01' }, now)
    expect(range.from).toBe('2026-10-31T22:00:00.000Z')
    expect(range.to).toBe('2026-11-19T21:59:59.999Z')
  })

  it('supports open-ended custom ranges', () => {
    const fromOnly = resolveDateRange({ from: '2026-11-01' }, now)
    expect(fromOnly.from).toBe('2026-10-31T22:00:00.000Z')
    expect(fromOnly.to).toBeNull()

    const toOnly = resolveDateRange({ to: '2026-11-01' }, now)
    expect(toOnly.from).toBeNull()
    expect(toOnly.to).toBe('2026-11-01T21:59:59.999Z')
  })

  it('falls back to the preset when a custom date is invalid', () => {
    const range = resolveDateRange({ dateRange: 'today', from: 'not-a-date' }, now)
    expect(range.preset).toBe('today')
    expect(range.from).toBe('2026-11-18T22:00:00.000Z')
  })

  it('defaults to all time', () => {
    const range = resolveDateRange({}, now)
    expect(range.from).toBeNull()
    expect(range.to).toBeNull()
    expect(range.preset).toBe('all')
  })

  it('also understands the legacy dateFrom/dateTo names', () => {
    const range = resolveDateRange({ dateFrom: '2026-11-01', dateTo: '2026-11-02' } as never, now)
    expect(range.from).toBe('2026-10-31T22:00:00.000Z')
    expect(range.to).toBe('2026-11-02T21:59:59.999Z')
  })
})
