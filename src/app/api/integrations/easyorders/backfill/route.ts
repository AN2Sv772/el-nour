import { NextRequest, NextResponse, after } from 'next/server'
import { requireUser } from '@/lib/supabase/require-user'
import { requireRole } from '@/lib/supabase/require-role'
import { getBackfillStatus, runBackfillBatch, startBackfill } from '@/lib/easyorders/backfill'
import { getInternalTriggerSecret, INTERNAL_TRIGGER_HEADER } from '@/lib/easyorders/internal-trigger'

/**
 * GET  /api/integrations/easyorders/backfill          → status + progress
 * POST /api/integrations/easyorders/backfill          → start (discover max, reset)
 * POST /api/integrations/easyorders/backfill?run=1    → run one batch (cron/manual)
 */
export async function GET() {
  // The backfill surface is an internal worker control panel — admin only.
  // (It used to accept any authenticated role, including viewer.)
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  const status = await getBackfillStatus()
  return NextResponse.json({ success: true, status })
}

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  const isCron = cronSecret ? authHeader === `Bearer ${cronSecret}` : false

  if (!isCron) {
    const auth = await requireRole('admin')
    if (auth instanceof NextResponse) return auth
  }

  const run = request.nextUrl.searchParams.get('run')

  try {
    if (run) {
      const result = await runBackfillBatch()
      const status = await getBackfillStatus()
      return NextResponse.json({ success: true, ...result, status })
    }
    const start = await startBackfill()
    const status = await getBackfillStatus()
    // Kick the self-chaining processor (queue drain + backfill batches)
    after(async () => {
      const origin = new URL(request.url).origin
      await fetch(`${origin}/api/integrations/easyorders/process-queue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_TRIGGER_HEADER]: getInternalTriggerSecret() ?? '',
        },
        body: JSON.stringify({}),
      }).catch(() => {})
    })
    return NextResponse.json({
      success: true,
      message: `بدأ الاستخراج التاريخي — ${start.maxId} طلب مكتشف. سيعمل تلقائيًا على دفعات (~30/دقيقة) حتى الاكتمال.`,
      maxId: start.maxId,
      status,
    })
  } catch (error) {
    console.error('backfill error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'backfill failed' },
      { status: 500 }
    )
  }
}
