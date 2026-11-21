"use client"

import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DashboardLayout } from '@/components/dashboard/dashboard-layout'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/shell/page-header'
import { cn, formatCurrency, formatNumber } from '@/lib/utils'
import {
  AlertTriangle,
  Bot,
  Calculator,
  Info,
  Loader2,
  Plus,
  Mic,
  Send,
  Sparkles,
  Table2,
  History,
} from 'lucide-react'

interface AgentAnswerPayload {
  text: string
  status: string
  evidence: {
    calculation: string
    sources: string[]
    missing: string[]
    metrics: { key: string; label: string; value: number | null; unit: string; status: string }[]
  }
  followUps: string[]
  tool: string
}

interface ChatResponse {
  mode: string
  provider: { label: string; model: string } | null
  detection: { intent: string; preset: string | null; comparePreset: string | null; confidence: number }
  answer: AgentAnswerPayload
  notice?: string
}

interface Turn {
  id: string
  question: string
  result: ChatResponse
}

const STATUS_LABEL: Record<string, string> = {
  answered: 'مجابة',
  partially_answered: 'مجابة جزئية',
  insufficient_data: 'البيانات غير كافية',
  calculation_unavailable: 'الحساب غير متاح',
  unable_to_retrieve: 'تعذّر الجلب',
}

const STATUS_STYLE: Record<string, string> = {
  answered: 'bg-success-muted text-success',
  partially_answered: 'bg-warning-muted text-warning',
  insufficient_data: 'bg-warning-muted text-warning',
  calculation_unavailable: 'bg-warning-muted text-warning',
  unable_to_retrieve: 'bg-destructive-muted text-destructive',
}

const SUGGESTIONS = [
  'كم مبيعات آخر 30 يوم؟',
  'ما هو صافي الربح؟',
  'كم نقداً عند شركات الشحن؟',
  'ما الذي ينقص من البيانات؟',
  'أفضل منتجاتي',
  'قارن مبيعات هذا الشهر بالشهر الماضي',
]

export default function AgentPage() {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ChatResponse | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // A question can arrive from the floating launcher on any screen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const incoming = params.get('q')
    if (incoming) {
      setQuestion('')
      void ask(incoming)
      window.history.replaceState({}, '', '/agent')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ask = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setLoading(true)
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'تعذّر الإجابة')
      setResult(data)
      setTurns(prev => [{ id: `${Date.now()}`, question: trimmed, result: data }, ...prev].slice(0, 12))
      setQuestion('')
    } catch (error) {
      const failure: ChatResponse = {
        mode: 'error',
        provider: null,
        detection: { intent: 'unknown', preset: null, comparePreset: null, confidence: 0 },
        answer: {
          text: error instanceof Error ? error.message : 'تعذّر الإجابة',
          status: 'unable_to_retrieve',
          evidence: { calculation: '', sources: [], missing: [], metrics: [] },
          followUps: [],
          tool: 'unknown',
        },
      }
      setResult(failure)
      setTurns(prev => [{ id: `${Date.now()}`, question: trimmed, result: failure }, ...prev].slice(0, 12))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [result, loading])

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader
          icon={Bot}
          title="المساعد"
          description="كل رقم هنا يأتي من محرّك المقاييس الموحّد — نفس الحساب الذي تراه في لوحة التحكم. إذا لم تكتمل البيانات، يقول المساعد إن الرقم محجوب وسببه، بدل أن يخمّن."
          actions={
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary-muted px-2 py-1 text-[11px] font-medium text-primary">
              <Calculator className="h-3 w-3" aria-hidden="true" />
              حساب مباشر من بياناتك
            </span>
          }
        />

        {/* ── The composer — the reference's chat input, in the product ─── */}
        <section className="card overflow-hidden">
          <div className="flex items-end gap-2 p-3">
            <Textarea
              ref={inputRef}
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void ask(question)
                }
              }}
              placeholder="اسأل عن مبيعاتك أو ربحك أو نقدك… مثال: كم مبيعات آخر 30 يوم؟"
              className="min-h-[64px] resize-none border-0 bg-transparent px-1 py-1 text-[13.5px] focus:ring-0"
              disabled={loading}
              aria-label="سؤالك للمساعد"
            />
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label="ملف">
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" className="btn-ghost h-8 w-8 p-0" aria-label="سؤال صوتي">
                <Mic className="h-4 w-4" aria-hidden="true" />
              </button>
              <Button
                onClick={() => void ask(question)}
                disabled={loading || !question.trim()}
                className="h-8 gap-1.5 px-3"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                اسأل
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-border-soft px-3 py-2.5">
            <span className="me-1 self-center text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              جرّب
            </span>
            {SUGGESTIONS.map(suggestion => (
              <button
                key={suggestion}
                onClick={() => void ask(suggestion)}
                disabled={loading}
                className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </section>

        {/* ── The thread ──────────────────────────────────────────────── */}
        {turns.length > 0 && (
          <div className="space-y-3">
            {turns.map((turn, index) => (
              <React.Fragment key={turn.id}>
                {/* The question, as the owner wrote it. */}
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-ee-md bg-primary-fill px-3.5 py-2 text-[13px] leading-relaxed text-white">
                    {turn.question}
                  </p>
                </div>

                {/* The answer. */}
                <div className="card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary-muted text-primary">
                      <Sparkles className="h-3 w-3" aria-hidden="true" />
                    </span>
                    <span className="text-[12px] font-semibold">النور</span>
                    <span
                      className={cn(
                        'rounded-md px-1.5 py-0.5 text-[10.5px] font-medium',
                        STATUS_STYLE[turn.result.answer.status] ?? 'bg-muted text-muted-foreground'
                      )}
                    >
                      {STATUS_LABEL[turn.result.answer.status] ?? turn.result.answer.status}
                    </span>
                    <span className="rounded-md border border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                      {turn.result.detection.intent}
                    </span>
                    {turn.result.provider && (
                      <span className="rounded-md border border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                        {turn.result.provider.label} · {turn.result.provider.model}
                      </span>
                    )}
                  </div>

                  {turn.result.notice && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-info/25 bg-info-muted px-3 py-2">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" aria-hidden="true" />
                      <p className="text-[11.5px] leading-relaxed">{turn.result.notice}</p>
                    </div>
                  )}

                  <p className="mt-3 whitespace-pre-line text-[13.5px] leading-relaxed text-foreground">
                    {turn.result.answer.text}
                  </p>

                  {/* The evidence — always visible, never hidden. */}
                  {turn.result.answer.evidence.metrics.length > 0 && (
                    <div className="mt-3 overflow-hidden rounded-xl border border-border">
                      <div className="flex items-center gap-2 border-b border-border-soft bg-card-2 px-3 py-2">
                        <Table2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        <p className="text-[11px] font-medium">الأرقام المستخدمة</p>
                      </div>
                      <table className="w-full text-[12px]">
                        <tbody>
                          {turn.result.answer.evidence.metrics.map(m => (
                            <tr key={m.key} className="border-b border-border-soft last:border-0">
                              <td className="px-3 py-1.5 text-muted-foreground">{m.label}</td>
                              <td className="px-3 py-1.5 text-left font-medium tabular-nums">
                                {m.value === null
                                  ? 'محجوب'
                                  : m.unit === 'count'
                                    ? formatNumber(m.value)
                                    : formatCurrency(m.value)}
                              </td>
                              <td className="px-3 py-1.5 text-left text-[10px] text-muted-foreground">
                                {m.status}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {turn.result.answer.evidence.missing.length > 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border-s-2 border-warning bg-warning-muted px-3 py-2">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                      <div>
                        <p className="text-[11px] font-semibold">ما لم يُحسب</p>
                        <ul className="mt-0.5 space-y-0.5">
                          {turn.result.answer.evidence.missing.slice(0, 6).map((item, i) => (
                            <li key={i} className="text-[11.5px] leading-relaxed text-muted-foreground">
                              • {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  {turn.result.answer.evidence.calculation && (
                    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                      طريقة الحساب: {turn.result.answer.evidence.calculation} · المصادر:{' '}
                      {turn.result.answer.evidence.sources.join('، ') || '—'}
                    </p>
                  )}

                  {turn.result.answer.followUps.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border-soft pt-3">
                      {turn.result.answer.followUps.map(followUp => (
                        <button
                          key={followUp}
                          onClick={() => void ask(followUp)}
                          className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                        >
                          {followUp}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {index === 0 && (
                  <details className="group">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground">
                      <History className="h-3.5 w-3.5" aria-hidden="true" />
                      كل الأسئلة السابقة ({turns.length})
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {turns.slice(1).map(previous => (
                        <li key={previous.id}>
                          <button
                            onClick={() => setResult(previous.result)}
                            className="w-full truncate rounded-lg px-2 py-1.5 text-start text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            {previous.question}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        {loading && (
          <div className="card flex items-center gap-2 p-4 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            يحسب المساعد من بياناتك…
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </DashboardLayout>
  )
}
