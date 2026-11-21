import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { User } from '@supabase/supabase-js'

/**
 * Verifies the caller's JWT with the Supabase Auth server and returns the
 * user, or a 401 NextResponse to return immediately from the route.
 *
 * Every API route MUST call this (middleware gating is UX-only — it does not
 * verify tokens). Usage:
 *
 *   const auth = await requireUser()
 *   if (auth instanceof NextResponse) return auth
 *   const { user } = auth
 */
export async function requireUser(): Promise<
  { user: User } | NextResponse
> {
  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'غير مصرح — يجب تسجيل الدخول' },
        { status: 401 }
      )
    }

    return { user }
  } catch {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'غير مصرح — يجب تسجيل الدخول' },
      { status: 401 }
    )
  }
}
