"use client"

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { PaginatedResponse, ApiResponse } from '@/types'

interface UseSupabaseOptions<T> {
  table: string
  select?: string
  filters?: Record<string, unknown>
  orderBy?: { column: string; ascending?: boolean }
  page?: number
  pageSize?: number
  enabled?: boolean
}

export function useSupabaseQuery<T>({
  table,
  select = '*',
  filters = {},
  orderBy,
  page = 1,
  pageSize = 20,
  enabled = true,
}: UseSupabaseOptions<T>) {
  const [data, setData] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!enabled) return

    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      let query = supabase.from(table).select(select, { count: 'exact' })

      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          query = query.eq(key, value)
        }
      })

      if (orderBy) {
        query = query.order(orderBy.column, { ascending: orderBy.ascending ?? false })
      }

      const from = (page - 1) * pageSize
      const to = from + pageSize - 1
      query = query.range(from, to)

      const { data: result, error: queryError, count } = await query

      if (queryError) throw queryError

      setData((result as T[]) || [])
      setTotal(count || 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [table, select, filters, orderBy, page, pageSize, enabled])

  const fetchDataRef = useRef(fetchData)
  fetchDataRef.current = fetchData

  useEffect(() => {
    if (enabled) {
      fetchDataRef.current()
    }
  }, [enabled])

  const refetch = useCallback(() => {
    fetchDataRef.current()
  }, [])

  return {
    data,
    total,
    loading,
    error,
    refetch,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

export function useSupabaseMutation<T>() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutate = async (
    operation: () => Promise<{ data: T | null; error: Error | null }>
  ): Promise<T | null> => {
    setLoading(true)
    setError(null)

    try {
      const { data, error: operationError } = await operation()
      if (operationError) throw operationError
      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }

  return { mutate, loading, error }
}

interface RealtimePayload<T> {
  eventType: string
  new: T
  old: T
}

export function useRealtimeSubscription<T>(
  table: string,
  filter?: string,
  onInsert?: (payload: T) => void,
  onUpdate?: (payload: T) => void,
  onDelete?: (payload: T) => void
) {
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase.channel(`realtime:${table}`)

    const eventConfig = {
      event: '*',
      schema: 'public',
      table,
      filter,
    }

    const handleRealtimeEvent = (payload: RealtimePayload<T>) => {
      switch (payload.eventType) {
        case 'INSERT':
          onInsert?.(payload.new)
          break
        case 'UPDATE':
          onUpdate?.(payload.new)
          break
        case 'DELETE':
          onDelete?.(payload.old)
          break
      }
    }

    if (filter) {
      void (channel as any).on(
        'postgres_changes',
        eventConfig,
        handleRealtimeEvent
      )
    } else {
      void (channel as any).on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
        },
        handleRealtimeEvent
      )
    }

    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, filter, onInsert, onUpdate, onDelete])
}
