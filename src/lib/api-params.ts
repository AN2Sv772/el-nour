/**
 * Shared request-parameter guards.
 *
 * Every API route that reads user input has to answer the same three
 * questions before it touches the database:
 *
 *   1. Is the value shaped like what the route expects? (pagination, sort
 *      column, date)
 *   2. Can the value change the MEANING of a PostgREST filter expression?
 *      (`.or()`, `.order()`, `.in()`)
 *   3. Is the value big enough to be a denial-of-service vector?
 *      (unbounded page sizes / limits)
 *
 * Before this module every route answered those questions differently — or
 * not at all — and the audit found seven endpoints that answered a malformed
 * request with HTTP 500 instead of HTTP 400:
 *
 *   GET /api/customers?page=999              -> PGRST103 (range not satisfiable)
 *   GET /api/customers?sortBy=nonexistent    -> 42703 (column does not exist)
 *   GET /api/orders?search=' OR 1=1--        -> edge WAF rejection
 *   GET /api/expenses?dateFrom=not-a-date    -> 22007 (invalid date)
 *   GET /api/dashboard/sales-chart?from=...  -> RangeError: Invalid time value
 *   GET /api/reports/financial?dateFrom=bad  -> 22007 (invalid date)
 *
 * The helpers below are the single source of truth for those answers.
 */

import { parseDateOnly } from './date-range'

/** Longest free-text search term accepted by any list endpoint. */
export const MAX_SEARCH_LENGTH = 120

/** Default and maximum page size for every paginated list endpoint. */
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 200

/** Default and maximum number of rows for "top N" style endpoints. */
export const DEFAULT_TOP_LIMIT = 5
export const MAX_TOP_LIMIT = 100

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

/** PostgREST filter metacharacters that must never reach a filter value. */
const FILTER_METACHARS = /[,()[\]]/g

/** SQL statement separators and comment markers. */
const STATEMENT_CHARS = /;|--|\/\*|\*\//g

/** SQL keywords that must not survive inside a hostile search term. */
const SQL_KEYWORDS =
  /\b(union|select|insert|update|delete|drop|alter|truncate|grant|revoke|exec|declare|where|from|or|and)\b/gi

/**
 * Patterns that look like an injection attempt rather than a real search
 * term. The edge WAF in front of Supabase rejects the whole request when it
 * sees them, which is why a harmless-looking search box could turn into an
 * HTTP 500.
 */
const HOSTILE_TERM =
  /(\b(union|select|insert|update|delete|drop|alter|truncate|grant|revoke|exec|declare|where|from)\b)|(\d+\s*=\s*\d+)|(\bor\b\s+\d)/i

/**
 * Normalise a free-text search term.
 *
 * - control characters are dropped
 * - PostgREST metacharacters (`,` `(` `)` `[` `]` `\`) become spaces
 * - statement separators (`;`, `--`, `/*`) become spaces
 * - quotes are removed ONLY when the term looks hostile; a legitimate name
 *   such as "O'Brien" keeps its apostrophe
 * - the result is capped at `MAX_SEARCH_LENGTH`
 *
 * Returns `null` when nothing usable is left.
 */
export function sanitizeSearchTerm(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null

  let out = String(value)
    .replace(CONTROL_CHARS, ' ')
    .replace(FILTER_METACHARS, ' ')
    .replace(STATEMENT_CHARS, ' ')
    // A backslash escapes the next character in a PostgREST value — drop it.
    .replace(/\\/g, '')
    // Double quotes delimit a PostgREST filter value — they are always removed.
    .replace(/["`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!out) return null

  if (HOSTILE_TERM.test(out)) {
    // Hostile: strip the remaining quotes, equality signs and SQL keywords so
    // the term can never re-assemble into a filter/logic expression — and so
    // the edge WAF in front of the database never sees the pattern.
    out = out
      .replace(/'/g, '')
      .replace(/=/g, ' ')
      .replace(SQL_KEYWORDS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  if (out.length > MAX_SEARCH_LENGTH) out = out.slice(0, MAX_SEARCH_LENGTH).trim()
  return out.length ? out : null
}

/** A value that is safe to use as a PostgREST `.or()` term value. */
export function escapeFilterValue(value: string): string {
  return sanitizeSearchTerm(value) ?? ''
}

/** True when the string is a canonical UUID. */
export function isUuid(value: string | null | undefined): boolean {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Parse a `YYYY-MM-DD` date parameter.
 *
 * `null` / empty input means "not provided" and is accepted.
 * Anything that is not a real calendar date is rejected with HTTP 400
 * instead of being forwarded to Postgres (which answers 22007) or to
 * `new Date()` (which answers `RangeError: Invalid time value`).
 */
export function parseDateParam(
  value: string | null | undefined,
  label = 'التاريخ'
): ParseResult<string | null> {
  const raw = (value ?? '').trim()
  if (!raw) return { ok: true, value: null }
  if (!parseDateOnly(raw)) {
    return { ok: false, error: `${label} غير صالح — التاريخ يجب أن يكون بصيغة YYYY-MM-DD` }
  }
  return { ok: true, value: raw }
}

/**
 * Parse a bounded integer parameter.
 *
 * Values outside `[min, max]` are rejected with HTTP 400 rather than being
 * clamped silently (a silent clamp makes the response disagree with what the
 * caller asked for) — except when `clamp` is enabled explicitly.
 */
export function parseBoundedInt(
  value: string | null | undefined,
  options: { min: number; max: number; defaultValue: number; label?: string; clamp?: boolean }
): ParseResult<number> {
  const { min, max, defaultValue, label = 'القيمة', clamp = false } = options
  const raw = (value ?? '').trim()
  if (!raw) return { ok: true, value: defaultValue }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return { ok: false, error: `${label} يجب أن يكون رقماً صحيحاً` }
  }
  if (parsed < min || parsed > max) {
    if (clamp) return { ok: true, value: Math.min(max, Math.max(min, parsed)) }
    return { ok: false, error: `${label} يجب أن يكون بين ${min} و ${max}` }
  }
  return { ok: true, value: parsed }
}

/** Parse a `page` / `pageSize` pair with a hard cap on the page size. */
export function parsePageParams(
  params: URLSearchParams,
  options: { defaultPageSize?: number; maxPageSize?: number } = {}
): ParseResult<{ page: number; pageSize: number; offset: number }> {
  const defaultPageSize = options.defaultPageSize ?? DEFAULT_PAGE_SIZE
  const maxPageSize = options.maxPageSize ?? MAX_PAGE_SIZE

  const page = parseBoundedInt(params.get('page'), {
    min: 1,
    max: 1_000_000,
    defaultValue: 1,
    label: 'رقم الصفحة',
  })
  if (!page.ok) return page

  const pageSize = parseBoundedInt(params.get('pageSize'), {
    min: 1,
    max: maxPageSize,
    defaultValue: defaultPageSize,
    label: 'حجم الصفحة',
  })
  if (!pageSize.ok) return pageSize

  return {
    ok: true,
    value: {
      page: page.value,
      pageSize: pageSize.value,
      offset: (page.value - 1) * pageSize.value,
    },
  }
}

/**
 * Resolve a sort column against an allow-list.
 *
 * An unknown column is a client error (HTTP 400), not a database error:
 * PostgREST answers `42703 column … does not exist`, which used to surface
 * as an HTTP 500.
 */
export function parseSortColumn<T extends string>(
  requested: string | null | undefined,
  allowed: Record<string, string>,
  fallback: T
): ParseResult<string> {
  const raw = (requested ?? '').trim()
  if (!raw) return { ok: true, value: allowed[fallback] }
  const column = allowed[raw]
  if (!column) {
    return { ok: false, error: `عمود الترتيب غير صالح — المسموح: ${Object.keys(allowed).join(', ')}` }
  }
  return { ok: true, value: column }
}

/** Resolve the sort direction (`asc` / `desc`). */
export function parseSortOrder(requested: string | null | undefined): boolean {
  return (requested ?? 'desc').trim().toLowerCase() === 'asc'
}
