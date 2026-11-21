import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let browserClient: SupabaseClient | null = null

// Type for the mock client to avoid `as any`
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
    signInWithPassword: () => Promise<{ data: null; error: { message: string } }>
    signInWithOAuth: () => Promise<{ data: null; error: { message: string } }>
    exchangeCodeForSession: () => Promise<{ data: null; error: { message: string } }>
  }
  channel: (name: string) => {
    on: () => { subscribe: () => { unsubscribe: () => {} } }
    subscribe: () => { unsubscribe: () => {} }
  }
  removeChannel: (name: string) => { }
}

export function createClient(): SupabaseClient {
  if (browserClient) return browserClient
  
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  // During build time, environment variables might not be available
  // Return a mock client that won't throw errors during static generation
  if (!url || !key) {
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
        signInWithPassword: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
        signInWithOAuth: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
        exchangeCodeForSession: () => Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }),
      },
      // @ts-ignore - Supabase mock types
      channel: () => ({
        // @ts-ignore - Supabase mock types
        on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
        // @ts-ignore - Supabase mock types
        subscribe: () => ({ unsubscribe: () => {} }),
      }),
      // @ts-ignore - Supabase mock types
      removeChannel: (): { success: boolean } => ({ success: true }),
    }
    return mockClient as unknown as SupabaseClient
  }
  
  browserClient = createBrowserClient(url, key)
  return browserClient
}
