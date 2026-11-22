import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The service-role client bypasses RLS, so the role check in
 * `require-role.ts` is the ONLY thing standing between a signed-in `viewer`
 * and the ability to change real orders. These tests cover it.
 */

const mockGetUser = vi.fn()
const mockProfile = vi.fn()

vi.mock('@/lib/supabase/require-user', () => ({
  requireUser: async () => {
    const result = await mockGetUser()
    if (result instanceof Error) return result
    return result
  },
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => ({
            maybeSingle: async () => mockProfile(),
          }),
        }),
      }),
    }),
  }),
}))

import { getUserRole, requireRole, hasRole, APP_ROLES } from './require-role'
import { NextResponse } from 'next/server'

describe('hasRole', () => {
  it('orders the roles by authority', () => {
    expect(hasRole('admin', 'viewer')).toBe(true)
    expect(hasRole('admin', 'manager')).toBe(true)
    expect(hasRole('manager', 'manager')).toBe(true)
    expect(hasRole('manager', 'admin')).toBe(false)
    expect(hasRole('employee', 'manager')).toBe(false)
    expect(hasRole('viewer', 'employee')).toBe(false)
    expect(hasRole('viewer', 'viewer')).toBe(true)
  })
})

describe('getUserRole', () => {
  beforeEach(() => {
    mockProfile.mockReset()
  })

  it('reads the role from user_profiles', async () => {
    mockProfile.mockResolvedValue({ data: { role: 'manager', is_active: true }, error: null })
    expect(await getUserRole('user-1')).toBe('manager')
  })

  it('denies a missing profile instead of granting viewer', async () => {
    mockProfile.mockResolvedValue({ data: null, error: null })
    expect(await getUserRole('user-1')).toBeNull()
  })

  it('denies an inactive profile instead of downgrading it to viewer', async () => {
    mockProfile.mockResolvedValue({ data: { role: 'admin', is_active: false }, error: null })
    expect(await getUserRole('user-1')).toBeNull()
  })

  it('denies an unknown role', async () => {
    mockProfile.mockResolvedValue({ data: { role: 'superuser', is_active: true }, error: null })
    expect(await getUserRole('user-1')).toBeNull()
  })

  it('fails closed when the profile cannot be read', async () => {
    mockProfile.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await getUserRole('user-1')).toBeNull()
  })
})

describe('requireRole', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockProfile.mockReset()
  })

  it('rejects an unauthenticated caller with 401', async () => {
    mockGetUser.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const result = await requireRole('employee')
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(401)
  })

  it('allows a sufficiently privileged user through', async () => {
    mockGetUser.mockResolvedValue({ user: { id: 'user-1' } })
    mockProfile.mockResolvedValue({ data: { role: 'admin', is_active: true }, error: null })
    const result = await requireRole('manager')
    expect(result).not.toBeInstanceOf(NextResponse)
    expect((result as { role: string }).role).toBe('admin')
  })

  it('rejects a viewer trying to change data with 403', async () => {
    mockGetUser.mockResolvedValue({ user: { id: 'user-1' } })
    mockProfile.mockResolvedValue({ data: { role: 'viewer', is_active: true }, error: null })
    const result = await requireRole('employee')
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })

  it('rejects an employee trying to perform an admin-only action', async () => {
    mockGetUser.mockResolvedValue({ user: { id: 'user-1' } })
    mockProfile.mockResolvedValue({ data: { role: 'employee', is_active: true }, error: null })
    const result = await requireRole('admin')
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })

  it('rejects a deactivated account on a viewer-only route with 403', async () => {
    mockGetUser.mockResolvedValue({ user: { id: 'user-1' } })
    mockProfile.mockResolvedValue({ data: { role: 'admin', is_active: false }, error: null })
    const result = await requireRole('viewer')
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })

  it('rejects an account with no profile on a viewer-only route with 403', async () => {
    mockGetUser.mockResolvedValue({ user: { id: 'user-1' } })
    mockProfile.mockResolvedValue({ data: null, error: null })
    const result = await requireRole('viewer')
    expect(result).toBeInstanceOf(NextResponse)
    expect((result as NextResponse).status).toBe(403)
  })
})

describe('role vocabulary', () => {
  it('exposes exactly the database enum values', () => {
    expect([...APP_ROLES].sort()).toEqual(['admin', 'employee', 'manager', 'viewer'])
  })
})
