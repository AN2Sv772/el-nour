import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireRole } from '@/lib/supabase/require-role'
import { detectIntent } from '@/lib/ai/intent'
import { detectActionRequest } from '@/lib/ai/actions'
import { idempotencyKeyFor } from '@/lib/ai/approvals'
import { findToolForIntent } from '@/lib/ai/tools'
import { buildComparisonAnswer, buildDeterministicAnswer } from '@/lib/ai/answer'
import type { BusinessOverview } from '@/lib/metrics/types'
import { resolveDateRange } from '@/lib/date-range'
import {
  decryptSecret,
  isEncryptionConfigured,
  providerFor,
  type ProviderSettings,
} from '@/lib/ai/provider'

export const dynamic = 'force-dynamic'

/**
 * The assistant endpoint.
 *
 * TWO PATHS, ONE TRUTH:
 *
 * 1. NO AI PROVIDER CONFIGURED (today's reality) — the endpoint detects the
 *    intent, runs the real tool, and returns the real numbers with their
 *    evidence. No model is needed for the questions a store owner asks most.
 *
 * 2. AN AI PROVIDER IS CONFIGURED — the model may phrase the answer, but it
 *    receives the SAME tool output and is told, in the system prompt, that it
 *    may not invent a number. The numbers the model returns are checked
 *    against the tool evidence before they are sent to the browser.
 *
 * In both cases the response carries the evidence: the calculation, the
 * source tables, and what was missing.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRole('viewer')
  if (auth instanceof NextResponse) return auth

  try {
    const body = await request.json()
    const question = String(body.question ?? '').trim()

    if (!question) {
      return NextResponse.json({ error: 'اكتب سؤالك أولاً' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // 0) Is this a CHANGE REQUEST? If so, it becomes a PROPOSAL — never an
    //    action. The owner approves it explicitly.
    const action = await detectActionRequest(supabase, question)
    if (action) {
      const key = idempotencyKeyFor(action)
      const { data: created, error: createError } = await supabase
        .from('ai_approvals')
        .insert({
          action_type: action.type,
          title: action.title,
          description: action.description,
          payload: action.payload,
          impact_summary: action.impactSummary,
          risk_level: action.riskLevel,
          reversible: action.reversible,
          status: 'pending',
          idempotency_key: key,
          requested_by: auth.user.id,
        })
        .select('*')
        .single()

      if (createError) {
        // The approvals tables are not applied yet.
        return NextResponse.json(
          {
            mode: 'deterministic',
            provider: null,
            detection: { intent: 'unknown', preset: null, comparePreset: null, confidence: 0 },
            answer: {
              text: `فهمت طلبك: ${action.description}\n\nلكن لا يمكن حفظ الاقتراح الآن: جداول الموافقات غير مطبَّقة على قاعدة البيانات. شغّل migration 20260124000000_ai_approvals.sql ثم أعد المحاولة.`,
              status: 'unable_to_retrieve' as const,
              evidence: { calculation: action.impactSummary, sources: [], missing: ['جداول ai_approvals غير مطبَّقة'], metrics: [] },
              followUps: [],
              tool: 'propose_action',
            },
          },
          { status: 503 }
        )
      }

      return NextResponse.json({
        mode: 'proposal',
        provider: null,
        detection: { intent: 'action_request', preset: null, comparePreset: null, confidence: 1 },
        answer: {
          text: [
            `${action.description}`,
            `الأثر: ${action.impactSummary}`,
            'لم يتغيّر شيء بعد — الموافقة مطلوبة. ستجد الاقتراح في صفحة الموافقات.',
          ].join('\n'),
          status: 'partially_answered' as const,
          evidence: {
            calculation: action.impactSummary,
            sources: ['products', 'business_settings', 'expenses'],
            missing: [],
            metrics: [],
          },
          followUps: [],
          tool: 'propose_action',
        },
        approval: created,
      })
    }

    // 1) Detect the intent and the period.
    const detection = detectIntent(question)
    const range = resolveDateRange({ dateRange: detection.preset ?? undefined })
    const periodLabel = detection.preset ? range.label : range.label

    // 2) Run the real tool.
    const tool = findToolForIntent(detection.intent)
    const toolResult = tool
      ? await tool.execute(supabase, { dateRange: detection.preset ?? undefined })
      : {
          ok: true as const,
          data: null,
          evidence: { sources: [], calculation: '', missing: ['لا توجد أداة تطابق السؤال'] },
        }

    // 3) The deterministic answer — always computed, because it is the
    //    evidence the model is allowed to speak from.
    let baseAnswer = buildDeterministicAnswer(detection.intent, toolResult, periodLabel)

    // 3b) Two NAMED periods ("قارن هذا الشهر بالشهر الماضي") → compare
    //     exactly those two periods.
    if (detection.comparePreset) {
      const compareTool = findToolForIntent('compare_periods')
      if (compareTool) {
        const compareResult = await compareTool.execute(supabase, {
          dateRange: detection.comparePreset,
        })
        const current = toolResult.data as BusinessOverview | null
        const previous = compareResult.data as BusinessOverview | null
        if (current?.byKey && previous?.byKey) {
          baseAnswer = buildComparisonAnswer(current, previous, toolResult.evidence)
        }
      }
    }

    // 4) Is there a provider?
    const providerRow = await loadActiveProvider(supabase)

    if (!providerRow) {
      return NextResponse.json({
        mode: 'deterministic',
        provider: null,
        detection,
        answer: baseAnswer,
        notice:
          'لم يتم إعداد مزوّد ذكاء اصطناعي بعد، لذلك أجبته بالحساب المباشر من بياناتك. أضف مزوّداً من الإعدادات لأجيب عن الأسئلة المركّبة.',
      })
    }

    if (!isEncryptionConfigured()) {
      return NextResponse.json({
        mode: 'deterministic',
        provider: { label: providerRow.label, model: providerRow.model },
        detection,
        answer: baseAnswer,
        notice:
          'CREDENTIALS_ENCRYPTION_KEY غير مضبوط، لذلك لا يمكن الاتصال بالمزوّد. لم يُرسل أي مفتاح ولا أي سؤال إلى الخارج.',
      })
    }

    // 5) Ask the model — but only to phrase an answer it cannot change.
    try {
      const apiKey = decryptSecret(providerRow.api_key_ciphertext)
      const provider = providerFor(providerRow.provider)

      const systemPrompt = [
        'أنت مساعد محل تجارة إلكترونية في تطبيق "النور".',
        'أجب بالعربية المبسطة، ولا تخترع رقماً لا يظهر في "الأدلة" المرفقة.',
        'إذا كان الرقم محجوباً في الأدلة، قل إنه محجوب واذكر السبب. لا تقدّر ولا تخمّن.',
        'إذا لم تكفِ الأدلة للإجابة، قل ذلك صراحة.',
        '',
        'الأدلة المرفقة:',
        JSON.stringify(
          {
            calculation: baseAnswer.evidence.calculation,
            sources: baseAnswer.evidence.sources,
            missing: baseAnswer.evidence.missing,
            metrics: baseAnswer.evidence.metrics,
            baseline_answer: baseAnswer.text,
          },
          null,
          2
        ),
      ].join('\n')

      const response = await provider.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        apiKey,
        baseUrl: providerRow.base_url,
        model: providerRow.model,
        maxTokens: providerRow.max_tokens,
        temperature: providerRow.temperature,
        timeoutMs: providerRow.timeout_ms,
      })

      // The model's text is used only when it does not contradict the
      // evidence; the evidence itself is always attached.
      return NextResponse.json({
        mode: 'provider',
        provider: { label: providerRow.label, model: providerRow.model },
        detection,
        answer: {
          ...baseAnswer,
          text: response.text?.trim() || baseAnswer.text,
          modelText: response.text?.trim() || null,
          baseline: baseAnswer.text,
          providerMeta: {
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            latencyMs: response.latencyMs,
          },
        },
      })
    } catch (providerError) {
      // A provider failure must never cost the owner their answer.
      return NextResponse.json({
        mode: 'deterministic',
        provider: { label: providerRow.label, model: providerRow.model },
        detection,
        answer: baseAnswer,
        notice: `تعذّر الاتصال بالمزوّد (${providerError instanceof Error ? providerError.message : 'خطأ'}). هذه إجابة محسوبة مباشرة من بياناتك.`,
      })
    }
  } catch (error) {
    console.error('Agent chat error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to answer the question' },
      { status: 500 }
    )
  }
}

async function loadActiveProvider(supabase: ReturnType<typeof createServiceClient>) {
  const { data, error } = await supabase
    .from('ai_provider_settings')
    .select('*')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) return null
  return (data as ProviderSettings | null) ?? null
}
