/**
 * Regression tests for F-012 (atomic counters) and F-013 (one sync-log row
 * per import run).
 *
 * F-012 — the live project reported `total_imported_orders = 19` while
 * `automation_logs` held 2 022 successful imports. The cause was a
 * read-modify-write on a single config row: two workers read the same base
 * value and the second write erased the first increment. The fix moves the
 * increment into the database (`increment_easyorders_counters`), and keeps
 * the legacy path only as a fallback for a deployment that has not applied
 * the migration yet.
 *
 * F-013 — only the manual sync route wrote to `easyorders_sync_logs`, so
 * the scanners (the paths that actually import the store's orders) left no
 * trace. The fix writes ONE row per run through `record_easyorders_sync_run`,
 * which updates the counters in the same transaction.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  stampEasyOrdersSync,
  recordEasyOrdersSyncRun,
  ATOMIC_COUNTER_RPC,
  SYNC_RUN_RPC,
  type StampConfig,
} from './sync'

type UpdateCall = { values: Record<string, unknown>; id: string }
type RpcCall = { fn: string; args: Record<string, unknown> }
type InsertCall = { table: string; values: Record<string, unknown> }

const MISSING_FN = { message: 'function public.increment_easyorders_counters does not exist', code: '42883' }

function fakeClient(
  config: StampConfig | null,
  opts: { rpcError?: { message?: string; code?: string } | null; rpcThrows?: boolean } = {}
) {
  const updates: UpdateCall[] = []
  const inserts: InsertCall[] = []
  const rpcCalls: RpcCall[] = []

  const client = {
    from: (table: string) => ({
      select: (cols: string) => ({
        limit: (n: number) => ({
          maybeSingle: async () => {
            if (table !== 'easyorders_config') throw new Error('unexpected table ' + table)
            return { data: config }
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async (col: string, val: string) => {
          updates.push({ values, id: val })
          return { data: null }
        },
      }),
      insert: (values: Record<string, unknown>) => {
        inserts.push({ table, values })
        return { select: (cols: string) => ({ single: async () => ({ data: { id: 'log-1' } }) }) }
      },
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (opts.rpcThrows) throw new Error('network down')
      return { data: null, error: opts.rpcError ?? null }
    },
  }
  return { client, updates, inserts, rpcCalls }
}

const AT = new Date('2026-11-20T10:00:00.000Z')

describe('F-012 — atomic counter increment', () => {
  it('increments through the database function (no read-modify-write)', async () => {
    const { client, updates, rpcCalls } = fakeClient({ id: 'cfg-1', total_imported_orders: 10 })

    const stamped = await stampEasyOrdersSync(client, 'created', AT)

    expect(stamped).toBe(true)
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].fn).toBe(ATOMIC_COUNTER_RPC)
    expect(rpcCalls[0].args.p_imported).toBe(1)
    expect(rpcCalls[0].args.p_updated).toBe(0)
    expect(rpcCalls[0].args.p_last_sync_at).toBe('2026-11-20T10:00:00.000Z')
    // The atomic path must NOT read the counter first.
    expect(updates).toHaveLength(0)
  })

  it('counts an update without inflating the imported counter', async () => {
    const { client, rpcCalls } = fakeClient({ id: 'cfg-1' })

    await stampEasyOrdersSync(client, 'updated', AT)

    expect(rpcCalls[0].args.p_imported).toBe(0)
    expect(rpcCalls[0].args.p_updated).toBe(1)
  })

  it('never moves the timestamp when nothing was imported', async () => {
    const { client, rpcCalls, updates } = fakeClient({ id: 'cfg-1' })

    expect(await stampEasyOrdersSync(client, 'skipped', AT)).toBe(false)
    expect(await stampEasyOrdersSync(client, 'ignored', AT)).toBe(false)
    expect(rpcCalls).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('falls back to the legacy write when the migration is not applied yet', async () => {
    // Deployment order must not matter: the migration and the code can ship
    // in either order.
    const { client, updates, rpcCalls } = fakeClient(
      { id: 'cfg-1', total_imported_orders: 10, total_updated_orders: 2 },
      { rpcError: MISSING_FN }
    )

    const stamped = await stampEasyOrdersSync(client, 'created', AT)

    expect(stamped).toBe(true)
    expect(rpcCalls).toHaveLength(1)
    expect(updates).toHaveLength(1)
    expect(updates[0].values.total_imported_orders).toBe(11)
  })

  it('never throws when the metadata write fails', async () => {
    const { client } = fakeClient({ id: 'cfg-1' }, { rpcThrows: true })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await stampEasyOrdersSync(client, 'created', AT)).toBe(false)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('F-013 — one sync-log row per import run', () => {
  it('writes the run through the database function', async () => {
    const { client, inserts, rpcCalls } = fakeClient({ id: 'cfg-1' })

    const logged = await recordEasyOrdersSyncRun(client, {
      syncType: 'backfill',
      status: 'success',
      processed: 15,
      imported: 4,
      updated: 1,
      skipped: 9,
      failed: 1,
      durationMs: 1234,
      triggeredBy: 'cron',
      errors: [{ message: 'boom' }],
      lastSyncAt: AT,
    })

    expect(logged).toBe(true)
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].fn).toBe(SYNC_RUN_RPC)
    expect(rpcCalls[0].args.p_sync_type).toBe('backfill')
    expect(rpcCalls[0].args.p_orders_processed).toBe(15)
    expect(rpcCalls[0].args.p_orders_imported).toBe(4)
    expect(rpcCalls[0].args.p_orders_updated).toBe(1)
    expect(rpcCalls[0].args.p_orders_skipped).toBe(9)
    expect(rpcCalls[0].args.p_orders_failed).toBe(1)
    expect(rpcCalls[0].args.p_duration_ms).toBe(1234)
    expect(rpcCalls[0].args.p_triggered_by).toBe('cron')
    expect(rpcCalls[0].args.p_errors).toEqual([{ message: 'boom' }])
    // The row is written by the database function (no direct INSERT).
    expect(inserts).toHaveLength(0)
  })

  it('does NOT touch the counters — the per-order stamp owns them', async () => {
    // Double counting would be worse than the original bug: every imported
    // order is already counted by `stampEasyOrdersSync` (atomically).
    const { client, updates } = fakeClient(
      { id: 'cfg-1', total_imported_orders: 10 },
      { rpcError: MISSING_FN }
    )

    await recordEasyOrdersSyncRun(client, { syncType: 'backfill', processed: 15, imported: 4, skipped: 11 })

    // The fallback path must not write `easyorders_config` at all.
    expect(updates).toHaveLength(0)
  })

  it('falls back to a direct INSERT when the migration is not applied yet', async () => {
    const { client, inserts, rpcCalls } = fakeClient(
      { id: 'cfg-1', total_imported_orders: 10 },
      { rpcError: MISSING_FN }
    )

    const logged = await recordEasyOrdersSyncRun(client, {
      syncType: 'catch-up',
      status: 'success',
      processed: 3,
      imported: 2,
      skipped: 1,
      lastSyncAt: AT,
    })

    expect(logged).toBe(true)
    expect(rpcCalls).toHaveLength(1)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe('easyorders_sync_logs')
    expect(inserts[0].values.sync_type).toBe('catch-up')
    expect(inserts[0].values.orders_processed).toBe(3)
    expect(inserts[0].values.orders_imported).toBe(2)
    expect(inserts[0].values.orders_skipped).toBe(1)
  })

  it('retries with a valid sync_type when the CHECK constraint rejects it', async () => {
    // `sync_type` is constrained to ('manual','webhook','scheduled','retry')
    // until the migration widens it. A rejected row = a LOST audit trail,
    // so the helper retries with 'scheduled' instead of dropping the run.
    // The client reports the rejection in the RESPONSE (PostgREST returns an
    // error object, it does not throw), so the helper must inspect it.
    const inserts: InsertCall[] = []
    const client = {
      from: (table: string) => ({
        select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        update: () => ({ eq: async () => ({ data: null }) }),
        insert: (values: Record<string, unknown>) => {
          inserts.push({ table, values })
          return {
            select: () => ({
              single: async () => {
                if (values.sync_type !== 'scheduled') {
                  return {
                    data: null,
                    error: {
                      message:
                        'new row for relation "easyorders_sync_logs" violates check constraint "easyorders_sync_logs_sync_type_check"',
                      code: '23514',
                    },
                  }
                }
                return { data: { id: 'log-2' }, error: null }
              },
            }),
          }
        },
      }),
      rpc: async (fn: string) => ({ data: null, error: MISSING_FN }),
    }

    const logged = await recordEasyOrdersSyncRun(client, { syncType: 'backfill', processed: 2, imported: 1 })

    expect(logged).toBe(true)
    expect(inserts).toHaveLength(2)
    expect(inserts[0].values.sync_type).toBe('backfill')
    expect(inserts[1].values.sync_type).toBe('scheduled')
  })

  it('retries with a valid sync_type when the client throws', async () => {
    // Defensive: some client wrappers do throw on a rejected insert.
    const inserts: InsertCall[] = []
    const client = {
      from: (table: string) => ({
        select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        update: () => ({ eq: async () => ({ data: null }) }),
        insert: (values: Record<string, unknown>) => {
          inserts.push({ table, values })
          return {
            select: () => ({
              single: async () => {
                if (values.sync_type !== 'scheduled') {
                  throw new Error(
                    'new row for relation "easyorders_sync_logs" violates check constraint "easyorders_sync_logs_sync_type_check"'
                  )
                }
                return { data: { id: 'log-3' }, error: null }
              },
            }),
          }
        },
      }),
      rpc: async (fn: string) => ({ data: null, error: MISSING_FN }),
    }

    const logged = await recordEasyOrdersSyncRun(client, { syncType: 'catch-up', processed: 1 })

    expect(logged).toBe(true)
    expect(inserts).toHaveLength(2)
    expect(inserts[1].values.sync_type).toBe('scheduled')
  })

  it('does not write a row when there is nothing to report', async () => {
    // A run that processed nothing still leaves a row (it is a trace of the
    // scanner), but it must not move the counters.
    const { client, inserts, rpcCalls } = fakeClient(
      { id: 'cfg-1', total_imported_orders: 10 },
      { rpcError: MISSING_FN }
    )

    await recordEasyOrdersSyncRun(client, { syncType: 'backfill', processed: 0, imported: 0, skipped: 0 })

    expect(inserts).toHaveLength(1)
    expect(rpcCalls[0].args.p_orders_imported).toBe(0)
    expect(rpcCalls[0].args.p_sync_type).toBe('backfill')
  })
})
