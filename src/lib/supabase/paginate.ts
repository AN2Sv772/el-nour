/**
 * Paginated PostgREST reads.
 *
 * PostgREST caps a single response at `max-rows` (1000 by default) and the
 * Supabase JS client does NOT paginate automatically — a plain `.select()`
 * silently returns only the FIRST 1000 rows. Any aggregation over more
 * than that (revenue, COGS, order counts by status) is therefore wrong
 * without explicit paging.
 *
 * These helpers walk the whole result set with explicit ranges, ordered by
 * a stable column so pages can neither overlap nor skip rows.
 */

export type PageBuilder<T> = (
  from: number,
  to: number
) => PromiseLike<{ data: T[] | null; error: unknown }>

/** Read every row of a PostgREST query, page by page. */
export async function fetchAllRows<T>(build: PageBuilder<T>, pageSize = 1000): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw error
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < pageSize) break
  }
  return rows
}

/**
 * Run a callback over every row of a query, without materialising the whole
 * result set in memory. Useful for aggregations over large tables.
 */
export async function forEachRow<T>(
  build: PageBuilder<T>,
  handler: (row: T) => void,
  pageSize = 1000
): Promise<number> {
  let seen = 0
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw error
    const batch = data ?? []
    for (const row of batch) handler(row)
    seen += batch.length
    if (batch.length < pageSize) break
  }
  return seen
}

/**
 * How many ids may be sent in a single PostgREST `in=()` filter.
 *
 * PostgREST encodes the filter into the request URL, and undici rejects a
 * request whose headers exceed 16 KB with `UND_ERR_HEADERS_OVERFLOW`
 * ("TypeError: fetch failed"). Each uuid costs ~39 characters once quoted and
 * comma-separated, so 200 ids ≈ 7.8 KB — comfortably inside the limit even
 * with the rest of the query string.
 */
export const IN_CHUNK_SIZE = 200

/** Split a list into fixed-size chunks. */
export function chunkArray<T>(items: T[], size = IN_CHUNK_SIZE): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * True when PostgREST refused a range because it starts past the last row.
 *
 * PostgREST answers `PGRST103: Requested range not satisfiable` for
 * `?offset=4990` on a 1915-row table. That is a client mistake (asking for
 * page 999 of a 3-page list), not a server failure — the routes answer it
 * with an empty page instead of an HTTP 500.
 */
export function isRangeNotSatisfiable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: string; message?: string }
  if (e.code === 'PGRST103') return true
  return /range not satisfiable/i.test(e.message || '')
}

/**
 * Read every row whose `column` value is in `values`.
 *
 * Combines both PostgREST limits that a plain `.in()` ignores:
 *   1. the 16 KB request-header limit — the id list is split into chunks,
 *   2. the 1000-row response cap — each chunk is paged.
 *
 * `build` receives one chunk of ids and returns a paged query for it.
 */
export async function fetchAllByIds<T>(
  build: (ids: string[]) => PageBuilder<T>,
  values: string[],
  chunkSize = IN_CHUNK_SIZE,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = []
  for (const ids of chunkArray(values, chunkSize)) {
    rows.push(...(await fetchAllRows(build(ids), pageSize)))
  }
  return rows
}
