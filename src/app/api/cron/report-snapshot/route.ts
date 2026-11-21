import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { buildBusinessOverview } from '@/lib/metrics/engine'
import { buildDecisions } from '@/lib/decisions/engine'
import { businessDateString, BUSINESS_TIME_ZONE } from '@/lib/date-range'

export const dynamic = 'force-dynamic'

/**
 * POST /api/cron/report-snapshot
 *
 * Writes yesterday's snapshot — the immutable record of how the business day
 * actually looked, with every number keeping its status.
 *
 * WHY A SNAPSHOT
 *
 * The dashboard shows the numbers NOW. If a product cost is edited or an
 * expense is voided tomorrow, today's dashboard silently becomes different —
 * and the owner can never see what the day really was. The snapshot freezes
 * it, WITH the incompleteness: a day whose costs were unknown is stored as
 * an incomplete day, not as a day with zero cost.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` — the same gate as the other
 * cron route. It FAILS CLOSED when the secret is not configured.
 */
export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
      return NextResponse.json(
        { error: 'CRON_SECRET غير مضبوط — تعطيل المسار بدل تشغيله بدون حماية' },
        { status: 503 }
      )
    }
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createServiceClient()

    // Which business day? "yesterday" in Cairo time, by default.
    const now = new Date()
    const requested = request.nextUrl.searchParams.get('date')
    const businessDate =
      requested ??
      businessDateString(new Date(now.getTime() - 86_400_000), BUSINESS_TIME_ZONE)

    const from = `${businessDate}T00:00:00.000+02:00`
    const to = `${businessDate}T23:59:59.999+02:00`

    const [overview, decisions] = await Promise.all([
      buildBusinessOverview(supabase, { dateRange: 'custom', from, to, includePrevious: false }),
      buildDecisions(supabase, { dateRange: 'custom', from, to }),
    ])

    // The snapshot keeps the honest payload — statuses included.
    const payload = {
      window: overview.window,
      metrics: overview.metrics.map(m => ({
        key: m.key,
        label: m.label,
        value: m.value,
        unit: m.unit,
        status: m.provenance.status,
        calculation: m.provenance.calculation,
        source: m.provenance.source,
        missing: m.provenance.missing,
      })),
      gaps: overview.gaps,
      alerts: overview.alerts,
      series: overview.series,
      decisions: decisions.decisions.map(d => ({
        id: d.id,
        severity: d.severity,
        title: d.title,
        why: d.why,
      })),
    }

    // A day whose profit could not be stated is PARTIAL — it is still a true
    // record, but it is not a complete one, and the snapshot says so.
    const incompleteMetrics = payload.metrics.filter(
      m => m.status !== 'actual' && m.status !== 'estimated'
    )
    const status = incompleteMetrics.length > 0 ? 'partial' : 'complete'
    const note =
      incompleteMetrics.length > 0
        ? `${incompleteMetrics.length} مؤشراً لم يكن مكتملاً في ذلك اليوم`
        : null

    const { data, error } = await supabase
      .from('report_snapshots')
      .upsert(
        {
          report_type: 'daily',
          business_date: businessDate,
          payload,
          status,
          note,
        },
        { onConflict: 'report_type,business_date' }
      )
      .select('id, business_date, status, created_at')
      .single()

    if (error) {
      // The migration has not been applied yet.
      return NextResponse.json(
        {
          error: 'تعذّر حفظ اللقطة — تأكد من تطبيق migration 20260125000000_report_snapshots.sql',
          detail: error.message,
          business_date: businessDate,
          computed: true,
          status,
        },
        { status: 503 }
      )
    }

    return NextResponse.json({
      success: true,
      snapshot: data,
      status,
      note,
    })
  } catch (error) {
    console.error('Report snapshot cron error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to write the snapshot' },
      { status: 500 }
    )
  }
}

/** GET — a health check (behind the session, like the other cron route). */
export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'report-snapshot-cron' })
}
