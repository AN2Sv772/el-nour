'use client'

import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

/**
 * Live updates for the orders table.
 *
 * WHY THIS FILE EXISTED AND WHY IT WAS BROKEN
 *
 * The original implementation:
 *   • never unsubscribed the channel (the cleanup function was returned
 *     from an inner async function and discarded) → every mount leaked a
 *     channel and every event was handled N times,
 *   • only logged the payload instead of refetching, so the UI never
 *     actually updated,
 *   • never removed the channel from the Supabase client, so the client
 *     kept a dead channel in its registry,
 *   • ignored its own `setOrders` argument.
 *
 * WHAT IT DOES NOW
 *
 * Two independent mechanisms, because only one of them can be relied on:
 *
 *   1. Postgres change subscriptions — instant, but they only fire for
 *      tables that are in the `supabase_realtime` publication. That
 *      publication is a DATABASE setting (DDL), so it cannot be changed
 *      from the application and must not be assumed.
 *   2. Polling — always works. The interval is paused while the tab is
 *      hidden and a refresh happens immediately when the tab becomes
 *      visible again, so a laptop that was asleep does not show stale
 *      data when the user comes back.
 */

export type RealtimeStatus = 'connecting' | 'live' | 'polling' | 'offline'

export interface UseRealtimeRefreshOptions {
  /** Called whenever data may have changed. */
  onChange: () => void
  /** Tables to watch for Postgres changes. */
  tables?: string[]
  /** Polling interval in milliseconds. `0` disables polling. */
  pollIntervalMs?: number
  /** Turn the whole thing off (e.g. while a filter is being edited). */
  enabled?: boolean
  /** Channel name — must be unique per mounted component. */
  channelName?: string
}

export function useRealtimeRefresh(options: UseRealtimeRefreshOptions): RealtimeStatus {
  const { tables = ['orders'], pollIntervalMs = 30_000, enabled = true, channelName } = options

  const [status, setStatus] = useState<RealtimeStatus>('offline')

  // Keep the callback in a ref so a new closure on every render does not
  // tear down and rebuild the subscription.
  const onChangeRef = useRef(options.onChange)
  useEffect(() => {
    onChangeRef.current = options.onChange
  }, [options.onChange])

  // A stable key for the table list (used as an effect dependency).
  const tablesKey = tables.join(',')

  useEffect(() => {
    if (!enabled) {
      setStatus('offline')
      return
    }

    let disposed = false
    let channel: RealtimeChannel | null = null
    let client: SupabaseClient | null = null

    /* ---------------- Realtime subscription ---------------- */
    const subscribe = async () => {
      try {
        const { createClient } = await import('@/lib/supabase/client')
        if (disposed) return

        client = createClient()
        const name =
          channelName ?? `live-${tablesKey}-${Math.random().toString(36).slice(2, 8)}`

        channel = client
          .channel(name)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: tablesKey.split(',')[0] },
            () => {
              if (!disposed) onChangeRef.current()
            }
          )
          .subscribe((subscriptionStatus: string) => {
            if (disposed) return
            if (subscriptionStatus === 'SUBSCRIBED') {
              setStatus(pollIntervalMs > 0 ? 'live' : 'live')
            } else if (subscriptionStatus === 'CHANNEL_ERROR' || subscriptionStatus === 'TIMED_OUT') {
              // The table is probably not in the realtime publication —
              // polling is the fallback, so the UI still updates.
              setStatus(pollIntervalMs > 0 ? 'polling' : 'offline')
            }
          })
      } catch {
        if (!disposed) setStatus(pollIntervalMs > 0 ? 'polling' : 'offline')
      }
    }

    void subscribe()

    /* ---------------- Polling fallback ---------------- */
    let interval: ReturnType<typeof setInterval> | null = null
    const startPolling = () => {
      if (interval !== null || pollIntervalMs <= 0) return
      interval = setInterval(() => {
        if (document.visibilityState === 'visible') onChangeRef.current()
      }, pollIntervalMs)
    }
    const stopPolling = () => {
      if (interval !== null) {
        clearInterval(interval)
        interval = null
      }
    }

    startPolling()

    // Refresh as soon as the user comes back to the tab — a backgrounded tab
    // pauses the polling, so the data can be minutes old.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onChangeRef.current()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    /* ---------------- Cleanup ---------------- */
    return () => {
      disposed = true
      stopPolling()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (channel) {
        try {
          client?.removeChannel(channel)
        } catch {
          try {
            channel.unsubscribe()
          } catch {
            /* the channel is already gone */
          }
        }
      }
    }
  }, [enabled, pollIntervalMs, tablesKey, channelName])

  return status
}

/* ------------------------------------------------------------------ */
/* Backwards-compatible wrappers                                      */
/* ------------------------------------------------------------------ */

/** Subscribe to order changes. `onChange` should trigger a refetch. */
export function useRealtimeOrders(
  onChange: () => void,
  options: { pollIntervalMs?: number; enabled?: boolean } = {}
): RealtimeStatus {
  return useRealtimeRefresh({
    onChange,
    tables: ['orders'],
    pollIntervalMs: options.pollIntervalMs ?? 30_000,
    enabled: options.enabled ?? true,
  })
}

/** Subscribe to product changes. `onChange` should trigger a refetch. */
export function useRealtimeProducts(
  onChange: () => void,
  options: { pollIntervalMs?: number; enabled?: boolean } = {}
): RealtimeStatus {
  return useRealtimeRefresh({
    onChange,
    tables: ['products'],
    pollIntervalMs: options.pollIntervalMs ?? 60_000,
    enabled: options.enabled ?? true,
  })
}
