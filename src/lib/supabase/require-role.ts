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
 * Returns `null` when the caller has NO usable role — and `null` means DENY,
 * not "the least privilege". A missing profile, a deactivated account, a
 * profile that cannot be read, or a role outside the vocabulary all deny.
 *
 * WHY THIS CHANGED
 * ----------------
 * This used to return `viewer` for every one of those cases. `viewer` is not
 * a safe fallback here: it still passes every `requireRole('viewer')` gate,
 * so a deactivated employee kept reading customers, orders and the financial
 * reports for as long as their session lived. The database already disagreed:
 * `app_role_rank()` in `20260120000000_align_rls_with_app_roles.sql` yields
 * `-1` (DENY) for a missing or inactive profile, and its own comment claims
 * it mirrors this file. The app layer is the one that actually applies — every
 * route reads through the service-role client, which bypasses RLS — so the
 * app layer is the one that has to fail closed.
 */
export async function getUserRole(userId: string): Promise<AppRole | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', userId)
    .limit(1)
    .maybeSingle()

  if (error) {
    // Fail CLOSED: an unreadable profile is not a reason to grant access.
    console.error('require-role: could not read user profile:', error.message)
    return null
  }
  if (!data) return null
  if (data.is_active === false) return null

  const role = String(data.role) as AppRole
  // An unknown role is corrupt data — deny it, exactly as the database does.
  return APP_ROLES.includes(role) ? role : null
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

  // No usable role — deactivated, unprovisioned, or an unreadable profile.
  if (!role) {
    return NextResponse.json(
      {
        error: 'Forbidden',
        message: 'هذا الحساب غير مُفعّل أو لا يملك ملف مستخدم صالح — راجع مدير النظام.',
      },
      { status: 403 }
    )
  }

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
