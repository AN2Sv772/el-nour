import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { isMissingBrainTables } from '@/lib/brain/status'

export const dynamic = 'force-dynamic'

const PROFILE_FIELDS = [
  'business_name',
  'website',
  'description',
  'description_ar',
  'industry',
  'market',
  'currency',
  'timezone',
  'goals_summary',
  'sales_channels',
  'connected_platforms',
  'primary_focus',
  'cash_floor',
  'max_daily_ad_spend',
  'hard_constraints',
  'never_rules',
  'status',
] as const

/**
 * The business profile — one row, the store's own description plus its
 * operating contract (the rules the agent must obey).
 *
 * GET: viewer.  PUT: admin.
 */
export async function GET() {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase.from('business_profile').select('*').limit(1).maybeSingle()

    if (error) {
      if (isMissingBrainTables(error)) {
        return NextResponse.json({ available: false, profile: null })
      }
      throw error
    }

    return NextResponse.json({ available: true, profile: data ?? null })
  } catch (error) {
    console.error('Brain profile GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read the profile' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const patch: Record<string, unknown> = {}

    for (const field of PROFILE_FIELDS) {
      if (body[field] !== undefined) patch[field] = body[field]
    }

    if (patch.business_name === undefined || String(patch.business_name).trim() === '') {
      return NextResponse.json({ error: 'اسم النشاط مطلوب' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { data: existing, error: readError } = await supabase
      .from('business_profile')
      .select('id')
      .limit(1)
      .maybeSingle()

    if (readError) {
      if (isMissingBrainTables(readError)) {
        return NextResponse.json(
          {
            error:
              'جداول Business Brain غير مطبَّقة بعد. شغّل migration 20260123000000_business_brain.sql أولاً.',
          },
          { status: 503 }
        )
      }
      throw readError
    }

    if (existing) {
      const { data, error } = await supabase
        .from('business_profile')
        .update(patch)
        .eq('id', existing.id)
        .select('*')
        .single()
      if (error) throw error
      return NextResponse.json({ available: true, profile: data })
    }

    const { data, error } = await supabase
      .from('business_profile')
      .insert(patch)
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ available: true, profile: data })
  } catch (error) {
    console.error('Brain profile PUT error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save the profile' },
      { status: 500 }
    )
  }
}
