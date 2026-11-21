import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { isMissingBrainTables } from '@/lib/brain/status'

export const dynamic = 'force-dynamic'

/**
 * The business goals — measurable targets keyed by the same metric keys the
 * metrics engine publishes (`revenue`, `net_profit`, `ad_spend`, …).
 *
 * GET: viewer.  PUT: admin (replaces the whole set — the owner is the only
 * one who decides what the targets are).
 */
export async function GET() {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('business_goals')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) {
      if (isMissingBrainTables(error)) {
        return NextResponse.json({ available: false, goals: [] })
      }
      throw error
    }

    return NextResponse.json({ available: true, goals: data ?? [] })
  } catch (error) {
    console.error('Brain goals GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to read the goals' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const goals = Array.isArray(body.goals) ? body.goals : []

    const rows = goals
      .filter((g: any) => g && g.metric_key && g.target !== undefined && g.target !== null)
      .map((g: any) => ({
        metric_key: String(g.metric_key),
        target: Number(g.target),
        unit: String(g.unit ?? 'currency'),
        period: String(g.period ?? 'monthly'),
        note: g.note ?? null,
        created_by: auth.user.id,
      }))

    const supabase = createServiceClient()
    const { error: deleteError } = await supabase.from('business_goals').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (deleteError) {
      if (isMissingBrainTables(deleteError)) {
        return NextResponse.json({ error: 'جداول Business Brain غير مطبَّقة بعد.' }, { status: 503 })
      }
      throw deleteError
    }

    if (rows.length === 0) {
      return NextResponse.json({ available: true, goals: [] })
    }

    const { data, error } = await supabase.from('business_goals').insert(rows).select('*')
    if (error) throw error

    return NextResponse.json({ available: true, goals: data ?? [] })
  } catch (error) {
    console.error('Brain goals PUT error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save the goals' },
      { status: 500 }
    )
  }
}
