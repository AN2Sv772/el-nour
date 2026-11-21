import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptSecret } from '@/lib/crypto'
import { requireRole } from '@/lib/supabase/require-role'
import { EASYORDERS_API_BASE, easyOrdersService, parseAcceptedWebhookSecrets } from '@/lib/easyorders/service'

/**
 * GET    /api/integrations/easyorders/webhook-config
 * DELETE /api/integrations/easyorders/webhook-config?url=<absolute url>
 *
 * Inspects and cleans up the webhook registration on the EasyOrders side.
 *
 * WHY
 * ---
 * EasyOrders creates webhooks ONLY from the seller dashboard
 * (Public API -> Webhooks -> Create Webhook) — the public API can only
 * DELETE a registration by URL. That makes it very easy to end up with a
 * stale registration pointing at an old deployment (a preview URL, a
 * previous domain) while the live dashboard silently never receives an
 * order.
 *
 * This route makes that state visible instead of invisible:
 *   - GET    lists what EasyOrders has registered for this store
 *   - DELETE removes a registration that points at the wrong URL
 *
 * Auth: admin only. The EasyOrders API key is read from the encrypted
 * config on the server and never leaves it.
 */

export const dynamic = 'force-dynamic'

function authHeaders(apiKey: string): Record<string, string> {
  return {
    // The app authenticates with `Api-Key`; the public documentation shows
    // `Authorization: Bearer`. Sending both covers either implementation.
    'Api-Key': apiKey,
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

async function readApiKey(): Promise<string | null> {
  const supabase = createServiceClient()
  const { data: config, error } = await supabase
    .from('easyorders_config')
    .select('api_key')
    .limit(1)
    .maybeSingle()
  if (error || !config?.api_key) return null
  if (!config.api_key.startsWith('v1:')) return config.api_key
  try {
    return decryptSecret(config.api_key)
  } catch {
    return null
  }
}

function targetWebhookUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  const origin = configured
    ? new URL(configured).origin
    : new URL(request.url).origin
  return `${origin}/api/integrations/easyorders/webhook`
}

export async function GET(request: NextRequest) {
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  const apiKey = await readApiKey()
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'لا يوجد مفتاح API محفوظ في EasyOrders.' },
      { status: 400 }
    )
  }

  const targetUrl = targetWebhookUrl(request)

  // What OUR side knows. This is the only reliable liveness signal:
  // EasyOrders exposes no "list webhooks" endpoint (GET /webhooks answers
  // 401 even with a valid key), so the evidence has to come from the
  // deliveries we actually received.
  const supabase = createServiceClient()
  const { data: config } = await supabase
    .from('easyorders_config')
    .select('last_webhook_at, last_sync_at')
    .limit(1)
    .maybeSingle()
  const { data: attempts } = await supabase
    .from('automation_logs')
    .select('id, type, status, created_at')
    .like('type', 'webhook%')
    .order('created_at', { ascending: false })
    .limit(10)

  try {
    const res = await fetch(`${EASYORDERS_API_BASE}/webhooks`, {
      method: 'GET',
      headers: authHeaders(apiKey),
      signal: AbortSignal.timeout(15_000),
    })
    const text = await res.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      /* keep the raw text */
    }

    const listed = Array.isArray(body)
      ? body
      : Array.isArray((body as { data?: unknown[] })?.data)
        ? (body as { data: unknown[] }).data
        : null

    return NextResponse.json({
      success: true,
      targetUrl,
      // `false` means "EasyOrders cannot list webhooks", NOT "there are none".
      listSupported: listed !== null,
      registered: listed,
      lastWebhookAt: config?.last_webhook_at ?? null,
      lastSyncAt: config?.last_sync_at ?? null,
      recentAttempts: attempts ?? [],
      instructions: [
        'من لوحة EasyOrders البائع: Public API → Webhooks → Create Webhook',
        `أدخل الرابط: ${targetUrl}`,
        'سيولّد EasyOrders سراً — انسخه إلى «Webhook Secret» في هذه الصفحة',
        'للتحقق: بعد الحفظ، ستجد محاولة «وصل» هنا وفي «آخر محاولات الـ Webhook»',
      ],
    })
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        targetUrl,
        error: e instanceof Error ? e.message : 'فشل الاتصال بـ EasyOrders',
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/integrations/easyorders/webhook-config
 *
 * Self-test: proves that OUR endpoint is live and that the stored secret is
 * the one the endpoint enforces.
 *
 * Two probes are sent to our own webhook URL:
 *   1. the CORRECT secret + an unrecognised payload  -> must answer 200
 *      (the secret is accepted; the payload is parked for review and NO
 *       order is created)
 *   2. a WRONG secret                                  -> must answer 401
 *      (the endpoint really enforces the secret)
 *
 * Both probe rows are deleted afterwards, so the database keeps no residue.
 *
 * What this CANNOT prove: that the secret EasyOrders holds is the same one
 * stored here. Only a real delivery from EasyOrders proves that — and it
 * requires the webhook to be created in the seller dashboard first.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  const apiKey = await readApiKey()
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'لا يوجد مفتاح API محفوظ في EasyOrders.' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()
  const { data: config } = await supabase
    .from('easyorders_config')
    .select('webhook_secret')
    .limit(1)
    .maybeSingle()
  if (!config?.webhook_secret) {
    return NextResponse.json(
      { success: false, error: 'لم يتم حفظ Webhook Secret بعد.' },
      { status: 400 }
    )
  }

  let storedSecret: string
  try {
    storedSecret = config.webhook_secret.startsWith('v1:')
      ? decryptSecret(config.webhook_secret)
      : config.webhook_secret
  } catch {
    return NextResponse.json(
      { success: false, error: 'فشل فك تشفير Webhook Secret المحفوظ.' },
      { status: 500 }
    )
  }

  const targetUrl = targetWebhookUrl(request)

  // The stored value may hold SEVERAL accepted secrets (one per EasyOrders
  // webhook). The probe must send ONE of them as the `secret` header — the
  // whole stored string is not a secret.
  const accepted = parseAcceptedWebhookSecrets(storedSecret)
  const probeSecret = accepted[0] ?? storedSecret

  // Optional: check a candidate secret (the one shown in the EasyOrders
  // dashboard) against the stored one. The stored value is NEVER returned —
  // only whether it matches — so this can be used safely from the browser.
  let candidate: string | null = null
  try {
    const body = await request.json()
    if (typeof body?.candidate_secret === 'string' && body.candidate_secret.trim()) {
      candidate = body.candidate_secret.trim()
    }
  } catch {
    /* no body */
  }
  if (candidate) {
    const matches = easyOrdersService.verifyWebhookSecret(candidate, storedSecret)
    return NextResponse.json({
      success: matches,
      matches,
      storedSecretCount: parseAcceptedWebhookSecrets(storedSecret).length,
      note: matches
        ? 'السر مطابق للسر المحفوظ — لا حاجة لتغييره.'
        : 'السر مختلف عن المحفوظ — احفظه لتفعيل الاستقبال.',
    })
  }

  const probeId = `selftest-${Date.now()}`
  // A payload the endpoint recognises as "valid secret but unknown event",
  // so the secret is exercised while no order is created.
  const probeBody = JSON.stringify({
    id: probeId,
    event_type: '__el_nour_selftest__',
    store_id: 'selftest',
  })

  const deliver = async (secret: string) => {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', secret },
      body: probeBody,
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    return { status: res.status, body: text.slice(0, 200) }
  }

  try {
    const good = await deliver(probeSecret)
    const bad = await deliver(`${probeSecret}-wrong`)

    // Remove the residue of both probes.
    await supabase
      .from('easyorders_webhook_events')
      .delete()
      .eq('payload->>id', probeId)
    await supabase
      .from('automation_logs')
      .delete()
      .eq('details->>easyorders_order_id', probeId)

    const secretAccepted = good.status === 200
    const secretEnforced = bad.status === 401

    return NextResponse.json({
      success: secretAccepted && secretEnforced,
      checks: {
        endpointLive: good.status > 0,
        secretAccepted,
        secretEnforced,
      },
      responses: { withCorrectSecret: good, withWrongSecret: bad },
      note:
        secretAccepted && secretEnforced
          ? 'المسار يعمل والسر مطابق. يبقى فقط إنشاء الـ Webhook في لوحة EasyOrders — لا يمكن التحقق من مطابقة السر هناك قبل وصول أول delivery حقيقي.'
          : 'المسار لا يعمل كما هو متوقع — راجع التفاصيل.',
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'فشل الاختبار' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRole('admin')
  if (auth instanceof NextResponse) return auth

  const url = request.nextUrl.searchParams.get('url')
  if (!url) {
    return NextResponse.json(
      { success: false, error: 'المطلوب: ?url=<رابط الـ webhook المراد حذفه>' },
      { status: 400 }
    )
  }

  const apiKey = await readApiKey()
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: 'لا يوجد مفتاح API محفوظ في EasyOrders.' },
      { status: 400 }
    )
  }

  try {
    const res = await fetch(
      `${EASYORDERS_API_BASE}/webhooks/delete-by-url?url=${encodeURIComponent(url)}`,
      { method: 'DELETE', headers: authHeaders(apiKey), signal: AbortSignal.timeout(15_000) }
    )
    const text = await res.text()
    return NextResponse.json({
      success: res.ok,
      status: res.status,
      deletedUrl: url,
      detail: res.ok ? undefined : text.slice(0, 400),
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'فشل الاتصال بـ EasyOrders' },
      { status: 500 }
    )
  }
}
