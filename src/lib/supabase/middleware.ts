import { createServerClient, type CookieOptions } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Type for the mock client
interface MockSupabaseClient {
  from: (table: string) => {
    select: () => { data: null; error: { message: string } }
    insert: () => { data: null; error: { message: string } }
    update: () => { data: null; error: { message: string } }
    delete: () => { data: null; error: { message: string } }
    eq: () => { data: null; error: { message: string } }
    or: () => { data: null; error: { message: string } }
    order: () => { data: null; error: { message: string } }
    range: () => { data: null; error: { message: string } }
    single: () => { data: null; error: { message: string } }
  }
  auth: {
    getUser: () => Promise<{ data: { user: null }; error: null }>
    getSession: () => Promise<{ data: { session: null }; error: null }>
  }
}

export function createClient(response: NextResponse): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  if (!url || !key) {
    // Return mock client during build
    const mockClient: MockSupabaseClient = {
      from: () => ({
        select: () => ({ data: null, error: { message: 'Supabase not configured' } }),
        insert: () => ({ data: null, error: { message: 'Supabase not configured' } }),
        update: () => ({ data: null, error: { message: 'Supabase not configured' } }),
        delete: () => ({ data: null, error: { message: 'Supabase not configured' } }),
        eq: () => ({ data: null, error: { message: 'Supabase not configured' } }),
        or: () => ({ data: null, error: { message: 'Supabase not configured' } }),
        order: () => ({ data: null, error: { message: 'Supabase not configured' } }),
        range: () => ({ data: null, error: { message: 'Supabase not configured' } }),
        single: () => ({ data: null, error: { message: 'Supabase not configured' } }),
      }),
      auth: {
        getUser: () => Promise.resolve({ data: { user: null }, error: null }),
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      },
    }
    return mockClient as unknown as SupabaseClient
  }
  
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return response.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })
}
