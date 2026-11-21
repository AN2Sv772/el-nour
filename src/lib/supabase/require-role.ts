import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireUser } from '@/lib/supabase/require-user'
import type { User } from '@supabase/supabase-js'

/**
 * Role-aware authorisation.
 *
 * WHY THIS EXISTS
 *
 * The database has proper role-based RLS policies on `orders`, `order_items`,
 * `user_profiles` and the EasyOrders tables — but EVERY API route in this
 * application reads and writes through the **service-role** client, which
 * bypasses RLS entirely. `requireUser()` only proves that a JWT belongs to
 * some user; it never checked the role.
 *
 * The result was that any signed-in account (including a `viewer`) could
 * create, change or cancel any order, and any signed-in account could
 * replace the EasyOrders API key or restart a full historical import.
 *
 * These helpers enforce the intended policy at the application layer, which
 * is the only layer that actually applies while the service-role client is
 * in use. `supabase/migrations/20260120000000_align_rls_with_app_roles.sql`
 * aligns the database policies with the same rules.
 */

export const APP_ROLES = ['admin', 'manager', 'employee', 'viewer'] as const
export type AppRole = (typeof APP_ROLES)[number]

/** Higher number = more authority. */
const ROLE_RANK: Record<AppRole, number> = {
  viewer: 0,
  employee: 1,
  manager: 2,
  admin: 3,
}

export interface AuthContext {
  user: User
  role: AppRole
}

/**
 * Resolve the caller's role from `user_profiles`.
 *
 * A missing profile is treated as `viewer` (the least privileged role), not
 * as an error — a signed-in user with no profile must not inherit the
 * permissions of an administrator.
 */
export async function getUserRole(userId: string): Promise<AppRole> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', userId)
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('require-role: could not read user profile:', error.message)
    return 'viewer'
  }
  if (!data) return 'viewer'
  if (data.is_active === false) return 'viewer'

  const role = String(data.role) as AppRole
  return APP_ROLES.includes(role) ? role : 'viewer'
}

/**
 * Require an authenticated user whose role is at least `minimum`.
 * Returns a NextResponse (401/403) that the caller should return directly.
 */
export async function requireRole(
  minimum: AppRole
): Promise<AuthContext | NextResponse> {
  const auth = await requireUser()
  if (auth instanceof NextResponse) return auth

  const role = await getUserRole(auth.user.id)

  if (ROLE_RANK[role] < ROLE_RANK[minimum]) {
    return NextResponse.json(
      {
        error: 'Forbidden',
        message: `هذه العملية تتطلب صلاحية ${minimum === 'admin' ? 'مدير عام' : minimum === 'manager' ? 'مدير' : minimum === 'employee' ? 'موظف' : 'مشاهد'} — صلاحيتك الحالية: ${role}`,
      },
      { status: 403 }
    )
  }

  return { user: auth.user, role }
}

/** Convenience: does the role satisfy the minimum requirement? */
export function hasRole(role: AppRole, minimum: AppRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum]
}
