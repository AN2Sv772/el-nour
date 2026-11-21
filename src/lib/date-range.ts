/**
 * Business-timezone date filtering.
 *
 * Every date filter in the application (orders list, dashboard stats, sales
 * chart, exports) resolves through THIS module, so a single range is used by
 * the table, the counters and the export.
 *
 * Why this exists (root cause of the historical bugs):
 *
 *  - The old `src/lib/date-presets.ts` claimed "Uses Africa/Cairo" but used
 *    the *host* timezone (`new Date().getHours()`), then converted with
 *    `toISOString()`. On a UTC server, "today" therefore meant the UTC day,
 *    not the Egyptian business day, and orders placed between 22:00 and
 *    24:00 Cairo time landed in the wrong bucket.
 *  - `toISO()` truncated the time to a date string, so `.lte('created_at',
 *    '2026-11-19')` compared against *midnight* and silently dropped every
 *    order created later that same day.
 *  - The orders API read `dateFrom`/`dateTo` while the dashboard read
 *    `dateRange`/`from`/`to`, so the table and the counters filtered over
 *    different ranges.
 *
 * All calculations here are explicit about the business timezone
 * (Africa/Cairo), DST-safe, and return UTC ISO instants suitable for
 * inclusive `gte` / `lte` database filters.
 */

export const BUSINESS_TIME_ZONE = 'Africa/Cairo'

export const DATE_RANGE_PRESETS = [
  { value: 'today', label: 'اليوم' },
  { value: 'yesterday', label: 'أمس' },
  { value: 'this_week', label: 'هذا الأسبوع' },
  { value: 'last_week', label: 'الأسبوع الماضي' },
  { value: 'this_month', label: 'هذا الشهر' },
  { value: 'last_month', label: 'الشهر الماضي' },
  { value: 'last_7_days', label: 'آخر 7 أيام' },
  { value: 'last_30_days', label: 'آخر 30 يومًا' },
  { value: 'this_year', label: 'هذا العام' },
  { value: 'all', label: 'كل الفترات' },
  { value: 'custom', label: 'فترة مخصصة' },
] as const

export type DateRangePresetValue = (typeof DATE_RANGE_PRESETS)[number]['value']

export interface ResolvedDateRange {
  /** Inclusive lower bound as a UTC ISO instant, or null for "no bound". */
  from: string | null
  /** Inclusive upper bound as a UTC ISO instant, or null for "no bound". */
  to: string | null
  /** The preset that produced the range ('custom' for explicit from/to). */
  preset: string
  /** Human label for the selected range. */
  label: string
}

/* ------------------------------------------------------------------ */
/* Timezone primitives                                                 */
/* ------------------------------------------------------------------ */

interface CalendarParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
}

const partsCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsCache.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsCache.set(timeZone, fmt)
  }
  return fmt
}

/** Wall-clock components of `instant` in the given timezone. */
export function calendarParts(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): CalendarParts {
  const parts = formatterFor(timeZone).formatToParts(instant)
  const map: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    // `hour12: false` can yield "24" for midnight in some ICU versions.
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

/** Offset of `timeZone` from UTC, in minutes, at the given instant. */
export function timezoneOffsetMinutes(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): number {
  const p = calendarParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - instant.getTime()) / 60000)
}

/**
 * Convert a wall-clock time in `timeZone` to the corresponding UTC instant.
 *
 * Two-pass so DST transitions resolve correctly: the first pass assumes the
 * offset at the naive UTC guess, the second corrects it.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
  timeZone: string = BUSINESS_TIME_ZONE
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, millisecond)
  const firstOffset = timezoneOffsetMinutes(new Date(naive), timeZone)
  let timestamp = naive - firstOffset * 60_000
  const secondOffset = timezoneOffsetMinutes(new Date(timestamp), timeZone)
  if (secondOffset !== firstOffset) {
    timestamp = naive - secondOffset * 60_000
  }
  return new Date(timestamp)
}

/** Calendar-safe day arithmetic (never 24h milliseconds, so DST is safe). */
export function addDays(
  year: number,
  month: number,
  day: number,
  days: number
): { year: number; month: number; day: number } {
  const t = new Date(Date.UTC(year, month - 1, day))
  t.setUTCDate(t.getUTCDate() + days)
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }
}

/* ------------------------------------------------------------------ */
/* Day / range boundaries                                              */
/* ------------------------------------------------------------------ */

/** Start of the business day containing `instant` (UTC ISO). */
export function startOfBusinessDay(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const p = calendarParts(instant, timeZone)
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, 0, 0, timeZone)
}

/** End of the business day containing `instant` (UTC ISO), inclusive. */
export function endOfBusinessDay(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const p = calendarParts(instant, timeZone)
  return zonedTimeToUtc(p.year, p.month, p.day, 23, 59, 59, 999, timeZone)
}

/** Parse a `YYYY-MM-DD` string into its calendar parts, or null if invalid. */
export function parseDateOnly(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // Reject impossible dates such as 2026-02-30.
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null
  }
  return { year, month, day }
}

/** `YYYY-MM-DD` for the business day containing `instant`. */
export function businessDateString(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  const p = calendarParts(instant, timeZone)
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

export const DEFAULT_DATE_PRESET = 'all'

/**
 * Compute the UTC bounds for a preset.
 *
 * Week starts on Sunday (Egypt's business week), matching the behaviour the
 * dashboard already had.
 */
export function getPresetRange(
  preset: string,
  now: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE
): { from: string | null; to: string | null } {
  const today = calendarParts(now, timeZone)
  const y = today.year
  const m = today.month
  const d = today.day

  // Day of week in the business timezone.
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday

  const startOfToday = () => zonedTimeToUtc(y, m, d, 0, 0, 0, 0, timeZone)
  const endOfToday = () => zonedTimeToUtc(y, m, d, 23, 59, 59, 999, timeZone)

  switch (preset) {
    case 'today':
      return { from: startOfToday().toISOString(), to: endOfToday().toISOString() }

    case 'yesterday': {
      const p = addDays(y, m, d, -1)
      return {
        from: zonedTimeToUtc(p.year, p.month, p.day, 0, 0, 0, 0, timeZone).toISOString(),
        to: zonedTimeToUtc(p.year, p.month, p.day, 23, 59, 59, 999, timeZone).toISOString(),
      }
    }

    case 'this_week': {
      const start = addDays(y, m, d, -dayOfWeek)
      return {
        from: zonedTimeToUtc(start.year, start.month, start.day, 0, 0, 0, 0, timeZone).toISOString(),
        to: endOfToday().toISOString(),
      }
    }

    case 'last_week': {
      const start = addDays(y, m, d, -dayOfWeek - 7)
      const end = addDays(y, m, d, -dayOfWeek - 1)
      return {
        from: zonedTimeToUtc(start.year, start.month, start.day, 0, 0, 0, 0, timeZone).toISOString(),
        to: zonedTimeToUtc(end.year, end.month, end.day, 23, 59, 59, 999, timeZone).toISOString(),
      }
    }

    case 'this_month':
      return {
        from: zonedTimeToUtc(y, m, 1, 0, 0, 0, 0, timeZone).toISOString(),
        to: endOfToday().toISOString(),
      }

    case 'last_month': {
      const firstOfThisMonth = new Date(Date.UTC(y, m - 1, 1))
      // Subtract a day from the first of this month to get the last day of
      // the previous month (calendar arithmetic, so month lengths are exact).
      const lastDayPrev = new Date(firstOfThisMonth.getTime() - 86_400_000)
      return {
        from: zonedTimeToUtc(lastDayPrev.getUTCFullYear(), lastDayPrev.getUTCMonth() + 1, 1, 0, 0, 0, 0, timeZone).toISOString(),
        to: zonedTimeToUtc(
          lastDayPrev.getUTCFullYear(),
          lastDayPrev.getUTCMonth() + 1,
          lastDayPrev.getUTCDate(),
          23, 59, 59, 999,
          timeZone
        ).toISOString(),
      }
    }

    case 'last_7_days': {
      const start = addDays(y, m, d, -6)
      return {
        from: zonedTimeToUtc(start.year, start.month, start.day, 0, 0, 0, 0, timeZone).toISOString(),
        to: endOfToday().toISOString(),
      }
    }

    case 'last_30_days': {
      const start = addDays(y, m, d, -29)
      return {
        from: zonedTimeToUtc(start.year, start.month, start.day, 0, 0, 0, 0, timeZone).toISOString(),
        to: endOfToday().toISOString(),
      }
    }

    case 'this_year':
      return {
        from: zonedTimeToUtc(y, 1, 1, 0, 0, 0, 0, timeZone).toISOString(),
        to: endOfToday().toISOString(),
      }

    case 'quarter': {
      const quarterStartMonth = Math.floor((m - 1) / 3) * 3 + 1
      return {
        from: zonedTimeToUtc(y, quarterStartMonth, 1, 0, 0, 0, 0, timeZone).toISOString(),
        to: endOfToday().toISOString(),
      }
    }

    // Legacy aliases kept so older callers keep working.
    case 'week':
      return getPresetRange('last_7_days', now, timeZone)
    case 'month':
      return getPresetRange('this_month', now, timeZone)
    case 'year':
      return getPresetRange('this_year', now, timeZone)

    case 'all':
    default:
      // No bounds — the database decides.
      return { from: null, to: null }
  }
}

/**
 * Resolve a date filter from request parameters.
 *
 * Accepts BOTH contracts so old and new callers work:
 *   - `dateRange=<preset>`
 *   - `from=YYYY-MM-DD&to=YYYY-MM-DD` (custom, inclusive)
 *
 * Custom `from`/`to` win over the preset. A custom range with only one bound
 * is treated as open-ended on the other side.
 */
export function resolveDateRange(
  input: {
    dateRange?: string | null
    from?: string | null
    to?: string | null
    /** Legacy alias for `from` (the old orders API contract). */
    dateFrom?: string | null
    /** Legacy alias for `to` (the old orders API contract). */
    dateTo?: string | null
  },
  now: Date = new Date()
): ResolvedDateRange {
  const preset = (input.dateRange || '').trim()
  const rawFrom = (input.from || input.dateFrom || '').trim()
  const rawTo = (input.to || input.dateTo || '').trim()

  const hasCustom = Boolean(rawFrom || rawTo)

  if (hasCustom) {
    const fromParts = rawFrom ? parseDateOnly(rawFrom) : null
    const toParts = rawTo ? parseDateOnly(rawTo) : null

    // Invalid custom dates fall back to the preset rather than silently
    // returning "everything" (which would look like the filter is broken).
    if ((rawFrom && !fromParts) || (rawTo && !toParts)) {
      const fallback = getPresetRange(preset || DEFAULT_DATE_PRESET, now)
      return { ...fallback, preset: preset || DEFAULT_DATE_PRESET, label: labelFor(preset || DEFAULT_DATE_PRESET) }
    }

    // Swap if the user selected the dates in the wrong order.
    let startParts = fromParts
    let endParts = toParts
    if (startParts && endParts) {
      const startKey = startParts.year * 10000 + startParts.month * 100 + startParts.day
      const endKey = endParts.year * 10000 + endParts.month * 100 + endParts.day
      if (startKey > endKey) [startParts, endParts] = [endParts, startParts]
    }

    return {
      from: startParts
        ? zonedTimeToUtc(startParts.year, startParts.month, startParts.day, 0, 0, 0, 0).toISOString()
        : null,
      to: endParts
        ? zonedTimeToUtc(endParts.year, endParts.month, endParts.day, 23, 59, 59, 999).toISOString()
        : null,
      preset: 'custom',
      label: customLabel(startParts, endParts),
    }
  }

  const range = getPresetRange(preset || DEFAULT_DATE_PRESET, now)
  return { ...range, preset: preset || DEFAULT_DATE_PRESET, label: labelFor(preset || DEFAULT_DATE_PRESET) }
}

function labelFor(preset: string): string {
  const found = DATE_RANGE_PRESETS.find(p => p.value === preset)
  return found ? found.label : 'كل الفترات'
}

function customLabel(
  from: { year: number; month: number; day: number } | null,
  to: { year: number; month: number; day: number } | null
): string {
  const fmt = (p: { year: number; month: number; day: number }) =>
    `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year}`
  if (from && to) return `${fmt(from)} — ${fmt(to)}`
  if (from) return `من ${fmt(from)}`
  if (to) return `حتى ${fmt(to)}`
  return 'كل الفترات'
}
