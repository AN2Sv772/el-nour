import { describe, it, expect, vi } from 'vitest'
import { chunkArray, fetchAllByIds, fetchAllRows, IN_CHUNK_SIZE } from './paginate'

describe('chunkArray', () => {
  it('splits a list into fixed-size chunks', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns an empty list for no values', () => {
    expect(chunkArray([], 10)).toEqual([])
  })

  it('rejects a non-positive chunk size', () => {
    expect(() => chunkArray([1], 0)).toThrow()
  })

  it('keeps every element exactly once', () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `id-${i}`)
    const chunks = chunkArray(ids, IN_CHUNK_SIZE)
    expect(chunks.flat()).toEqual(ids)
    expect(chunks.every(c => c.length <= IN_CHUNK_SIZE)).toBe(true)
  })
})

describe('fetchAllByIds', () => {
  it('never sends more than one chunk of ids per request', async () => {
    // Regression: PostgREST puts `in=()` in the request URL and undici rejects
    // headers over 16 KB with UND_ERR_HEADERS_OVERFLOW. 1 000 uuid filters
    // build a ~39 KB URL.
    const MAX_URL = 16 * 1024
    const ids = Array.from({ length: 1000 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    )
    const build = vi.fn((chunk: string[]) => {
      const url = `https://db.supabase.co/rest/v1/order_items?order_id=in.(${chunk.join(',')})`
      expect(url.length).toBeLessThan(MAX_URL)
      return async () => ({ data: chunk.map(id => ({ order_id: id })), error: null })
    })

    const rows = await fetchAllByIds(build, ids)

    expect(rows).toHaveLength(1000)
    expect(build).toHaveBeenCalledTimes(Math.ceil(1000 / IN_CHUNK_SIZE))
    for (const call of build.mock.calls) {
      expect(call[0].length).toBeLessThanOrEqual(IN_CHUNK_SIZE)
    }
  })

  it('pages within a chunk instead of stopping at the 1000-row cap', async () => {
    const build = (chunk: string[]) => async (from: number, to: number) => {
      const all = chunk.flatMap(id => [0, 1, 2].map(n => ({ order_id: `${id}-${n}` })))
      return { data: all.slice(from, to + 1), error: null }
    }
    const rows = await fetchAllByIds(build, ['a', 'b'], IN_CHUNK_SIZE, 2)
    expect(rows).toHaveLength(6)
    expect(rows.map(r => r.order_id)).toEqual([
      'a-0', 'a-1', 'a-2', 'b-0', 'b-1', 'b-2',
    ])
  })

  it('propagates a query error', async () => {
    const build = () => async () => ({ data: null, error: { message: 'boom' } })
    await expect(fetchAllByIds(build, ['a'])).rejects.toEqual({ message: 'boom' })
  })

  it('returns an empty array for no ids', async () => {
    const build = vi.fn()
    expect(await fetchAllByIds(build, [])).toEqual([])
    expect(build).not.toHaveBeenCalled()
  })
})

describe('fetchAllRows', () => {
  it('walks every page and stops on a short page', async () => {
    let call = 0
    const build = async (from: number, to: number) => {
      call++
      const size = call === 1 ? to - from + 1 : 3 // first page full, second short
      return {
        data: Array.from({ length: size }, (_, i) => from + i),
        error: null,
      }
    }
    const rows = await fetchAllRows(build, 1000)
    expect(call).toBe(2)
    expect(rows).toHaveLength(1003)
    expect(rows[0]).toBe(0)
    expect(rows[rows.length - 1]).toBe(1002)
  })

  it('propagates an error', async () => {
    const build = async () => ({ data: null, error: { message: 'nope' } })
    await expect(fetchAllRows(build)).rejects.toEqual({ message: 'nope' })
  })
})
