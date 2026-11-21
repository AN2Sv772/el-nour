/**
 * Regression tests for the "last sync" metadata.
 *
 * The Settings screen shows when the dashboard was last refreshed. Both
 * import paths (the webhook queue and the daily catch-up backfill) go
 * through `processWebhookEvent`, so the stamp has to happen there — and it
 * must only move when data actually changed.
 */
import { describe, it, expect, vi } from 'vitest'
import { stampEasyOrdersSync, type StampConfig } from './sync'

type UpdateCall = { values: Record<string, unknown>; id: string }

function fakeClient(
  config: StampConfig | null,
  opts: { throwOnUpdate?: boolean } = {}
) {
  const updates: UpdateCall[] = []
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
          if (opts.throwOnUpdate) throw new Error('db down')
          updates.push({ values, id: val })
          return { data: null }
        },
      }),
    }),
  }
  return { client, updates }
}

const AT = new Date('2026-11-20T10:00:00.000Z')

describe('stampEasyOrdersSync', () => {
  it('moves last_sync_at when an order was created', async () => {
    const { client, updates } = fakeClient({
      id: 'cfg-1',
      total_imported_orders: 10,
      total_updated_orders: 2,
    })

    const stamped = await stampEasyOrdersSync(client, 'created', AT)

    expect(stamped).toBe(true)
    expect(updates).toHaveLength(1)
    expect(updates[0].values.last_sync_at).toBe('2026-11-20T10:00:00.000Z')
    expect(updates[0].values.last_sync_status).toBe('success')
    expect(updates[0].values.last_sync_error).toBeNull()
    expect(updates[0].values.total_imported_orders).toBe(11)
    expect(updates[0].values.total_updated_orders).toBe(2)
    expect(updates[0].id).toBe('cfg-1')
  })

  it('counts an update without inflating the imported counter', async () => {
    const { client, updates } = fakeClient({
      id: 'cfg-1',
      total_imported_orders: 10,
      total_updated_orders: 2,
    })

    await stampEasyOrdersSync(client, 'updated', AT)

    expect(updates[0].values.total_imported_orders).toBe(10)
    expect(updates[0].values.total_updated_orders).toBe(3)
  })

  it('does NOT move the timestamp when nothing was imported', async () => {
    // A skipped order means the data did not change — claiming a fresh sync
    // would tell the operator the dashboard is current when it is not.
    const { client, updates } = fakeClient({ id: 'cfg-1' })

    expect(await stampEasyOrdersSync(client, 'skipped', AT)).toBe(false)
    expect(await stampEasyOrdersSync(client, 'ignored', AT)).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('does not stamp when there is no config row', async () => {
    const { client, updates } = fakeClient(null)

    expect(await stampEasyOrdersSync(client, 'created', AT)).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('never throws when the metadata write fails', async () => {
    // An import that succeeded must not be reported as failed because a
    // bookkeeping column could not be written.
    const { client } = fakeClient({ id: 'cfg-1' }, { throwOnUpdate: true })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await stampEasyOrdersSync(client, 'created', AT)).toBe(false)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
