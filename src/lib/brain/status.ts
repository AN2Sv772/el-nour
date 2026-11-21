/**
 * The Brain's status and coverage — computed, never stored as a guess.
 *
 * Coverage % answers ONE question: of the questions the owner can answer, how
 * many are answered? It is deliberately not a score of quality: a 90% Brain
 * can still be wrong about one thing, and the item-level status (verified /
 * conflicted / outdated) is what tells the truth about each fact.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BRAIN_QUESTIONS } from './questions'

export type BrainStatus =
  | 'not_configured'
  | 'incomplete'
  | 'learning'
  | 'ready'
  | 'needs_attention'
  | 'outdated'

export const BRAIN_STATUS_LABEL: Record<BrainStatus, string> = {
  not_configured: 'غير مُعد',
  incomplete: 'غير مكتمل',
  learning: 'في مرحلة التعلّم',
  ready: 'جاهز',
  needs_attention: 'يحتاج انتباهك',
  outdated: 'يحتاج تحديث',
}

export const BRAIN_STATUS_DESCRIPTION: Record<BrainStatus, string> = {
  not_configured: 'لم يتم إعداد ملف النشاط بعد. ابدأ بإجابة الأسئلة.',
  incomplete: 'ما زالت هناك أسئلة مفتوحة تجيب عنها بنفسك.',
  learning: 'هناك عملية تدقيق أو تعلّم قيد التنفيذ.',
  ready: 'يعرف النظام عملك جيداً. راجع التفاصيل قبل الاعتماد على إجاباته.',
  needs_attention: 'هناك معلومات متعارضة أو ناقصة تحتاج قراراً منك.',
  outdated: 'بعض المعلومات تجاوزت موعد مراجعتها. حدّثها لتعود الدقة.',
}

export interface BrainQuestionRow {
  question_key: string
  status: 'open' | 'answered' | 'skipped'
  answer: string | null
  answer_source: string | null
  answered_at: string | null
  check_in_months: number | null
}

export interface BrainKnowledgeRow {
  id: string
  topic: string
  title: string
  kind: string
  source_kind: string
  status: string
  confidence: number | string | null
  last_checked_at: string | null
  check_in_months: number | null
  effective_until: string | null
  updated_at: string | null
}

export interface BrainProfileRow {
  id: string
  business_name: string
  status: BrainStatus
  primary_focus: string | null
  currency: string
  timezone: string
  never_rules: string[] | null
  hard_constraints: string[] | null
  cash_floor: number | string | null
  max_daily_ad_spend: number | string | null
  goals_summary: string | null
  updated_at: string | null
}

export interface BrainRunRow {
  status: string
  started_at: string | null
  finished_at: string | null
  coverage_before: number | string | null
  coverage_after: number | string | null
}

export interface BrainGap {
  id: string
  area: string
  label: string
  severity: 'info' | 'warning' | 'critical'
  kind: 'open_question' | 'conflicted' | 'outdated' | 'unverified' | 'missing_profile'
  questionKey?: string
  knowledgeId?: string
}

export interface BrainStatusReport {
  status: BrainStatus
  statusLabel: string
  statusDescription: string
  coverage: number
  answered: number
  answerable: number
  total: number
  openRequired: number
  skippedRequired: number
  knowledge: {
    total: number
    verified: number
    unverified: number
    conflicted: number
    outdated: number
    forgotten: number
  }
  gaps: BrainGap[]
  areas: {
    key: string
    answered: number
    answerable: number
    coverage: number
  }[]
  lastRun: {
    status: string
    startedAt: string | null
    finishedAt: string | null
    coverageBefore: number | null
    coverageAfter: number | null
  } | null
}

/** The denominator: the required questions that can actually be answered. */
export function answerableQuestions() {
  return BRAIN_QUESTIONS.filter(q => q.required)
}

export function computeCoverage(rows: BrainQuestionRow[]): {
  coverage: number
  answered: number
  answerable: number
  total: number
  openRequired: number
  skippedRequired: number
} {
  const answerable = answerableQuestions()
  const rowByKey = new Map(rows.map(r => [r.question_key, r]))

  let answered = 0
  let skipped = 0
  let open = 0

  for (const definition of answerable) {
    const row = rowByKey.get(definition.key)
    if (row?.status === 'answered' && row.answer && row.answer.trim().length > 0) {
      answered += 1
    } else if (row?.status === 'skipped') {
      skipped += 1
    } else {
      // No row at all means "never answered" — which is an OPEN question.
      open += 1
    }
  }

  const total = answerable.length

  return {
    // 0% when nothing is answerable yet — never a division by zero.
    coverage: total === 0 ? 0 : Math.round((answered / total) * 100),
    answered,
    answerable: total,
    total,
    openRequired: open,
    skippedRequired: skipped,
  }
}

function isOutdated(row: BrainKnowledgeRow, now: Date): boolean {
  if (row.status === 'outdated') return true
  if (row.status === 'forgotten') return false
  if (row.effective_until) {
    const until = new Date(row.effective_until).getTime()
    if (Number.isFinite(until) && until < now.getTime()) return true
  }
  if (row.check_in_months && row.last_checked_at) {
    const checked = new Date(row.last_checked_at).getTime()
    if (!Number.isFinite(checked)) return false
    const due = new Date(checked)
    due.setMonth(due.getMonth() + row.check_in_months)
    return due.getTime() < now.getTime()
  }
  return false
}

/**
 * The full status report.
 *
 * Everything here is derived from real rows. When the tables do not exist yet
 * (migration not applied), the caller gets a `not_configured` report rather
 * than a crash.
 */
export function computeBrainStatus(input: {
  profile: BrainProfileRow | null
  questions: BrainQuestionRow[]
  knowledge: BrainKnowledgeRow[]
  lastRun?: { status: string; started_at: string | null; finished_at: string | null; coverage_before: number | string | null; coverage_after: number | string | null } | null
  now?: Date
}): BrainStatusReport {
  const now = input.now ?? new Date()
  const { profile, questions, knowledge } = input

  const coverageInfo = computeCoverage(questions)
  const questionByKey = new Map(questions.map(q => [q.question_key, q]))

  const knowledgeCounts = {
    total: knowledge.length,
    verified: knowledge.filter(k => k.status === 'verified').length,
    unverified: knowledge.filter(k => k.status === 'unverified').length,
    conflicted: knowledge.filter(k => k.status === 'conflicted').length,
    outdated: knowledge.filter(k => k.status === 'outdated').length,
    forgotten: knowledge.filter(k => k.status === 'forgotten').length,
  }

  const gaps: BrainGap[] = []

  if (!profile) {
    gaps.push({
      id: 'missing_profile',
      area: 'business_basics',
      label: 'لم يتم إنشاء ملف النشاط بعد.',
      severity: 'critical',
      kind: 'missing_profile',
    })
  }

  // Open required questions.
  for (const definition of BRAIN_QUESTIONS) {
    if (!definition.required) continue
    const row = questionByKey.get(definition.key)
    if (!row || row.status === 'open') {
      gaps.push({
        id: `open:${definition.key}`,
        area: definition.area,
        label: definition.prompt_ar,
        severity: 'warning',
        kind: 'open_question',
        questionKey: definition.key,
      })
    }
  }

  // Conflicted knowledge — a direct contradiction needs the owner.
  for (const item of knowledge) {
    if (item.status === 'conflicted') {
      gaps.push({
        id: `conflicted:${item.id}`,
        area: item.topic,
        label: `معلومة متعارضة: ${item.title}`,
        severity: 'critical',
        kind: 'conflicted',
        knowledgeId: item.id,
      })
    } else if (isOutdated(item, now)) {
      gaps.push({
        id: `outdated:${item.id}`,
        area: item.topic,
        label: `معلومة تحتاج تحديثاً: ${item.title}`,
        severity: 'warning',
        kind: 'outdated',
        knowledgeId: item.id,
      })
    }
  }

  // Area coverage.
  const areas = Array.from(new Set(BRAIN_QUESTIONS.map(q => q.area))).map(area => {
    const areaQuestions = answerableQuestions().filter(q => q.area === area)
    const areaKeys = new Set(areaQuestions.map(q => q.key))
    const answered = areaQuestions.filter(q => {
      const row = questionByKey.get(q.key)
      return row && row.status === 'answered' && row.answer && row.answer.trim().length > 0
    }).length
    return {
      key: area,
      answered,
      answerable: areaKeys.size,
      coverage: areaKeys.size === 0 ? 0 : Math.round((answered / areaKeys.size) * 100),
    }
  })

  // Status decision — the order matters.
  let status: BrainStatus
  if (!profile) {
    status = 'not_configured'
  } else if (input.lastRun && input.lastRun.status === 'running') {
    status = 'learning'
  } else if (gaps.some(g => g.severity === 'critical' && g.kind === 'conflicted')) {
    status = 'needs_attention'
  } else if (knowledge.some(k => isOutdated(k, now))) {
    status = 'outdated'
  } else if (coverageInfo.coverage >= 80 && coverageInfo.openRequired === 0) {
    status = 'ready'
  } else {
    status = 'incomplete'
  }

  return {
    status,
    statusLabel: BRAIN_STATUS_LABEL[status],
    statusDescription: BRAIN_STATUS_DESCRIPTION[status],
    coverage: coverageInfo.coverage,
    answered: coverageInfo.answered,
    answerable: coverageInfo.answerable,
    total: coverageInfo.total,
    openRequired: coverageInfo.openRequired,
    skippedRequired: coverageInfo.skippedRequired,
    knowledge: knowledgeCounts,
    gaps,
    areas,
    lastRun: input.lastRun
      ? {
          status: input.lastRun.status,
          startedAt: input.lastRun.started_at,
          finishedAt: input.lastRun.finished_at,
          coverageBefore:
            input.lastRun.coverage_before === null || input.lastRun.coverage_before === undefined
              ? null
              : Number(input.lastRun.coverage_before),
          coverageAfter:
            input.lastRun.coverage_after === null || input.lastRun.coverage_after === undefined
              ? null
              : Number(input.lastRun.coverage_after),
        }
      : null,
  }
}

/** True when the Brain tables are not in the database yet. */
export function isMissingBrainTables(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const text = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase()
  return (
    text.includes('does not exist') ||
    text.includes('42p01') ||
    text.includes('relation') ||
    text.includes('schema cache')
  )
}

/**
 * Read the Brain rows. Returns `null` when the tables are missing, so the
 * caller can answer "not configured yet" instead of failing.
 */
export async function readBrainRows(db: SupabaseClient): Promise<{
  profile: BrainProfileRow | null
  questions: BrainQuestionRow[]
  knowledge: BrainKnowledgeRow[]
  lastRun: BrainRunRow | null
} | null> {
  const [profileRes, questionsRes, knowledgeRes, runRes] = await Promise.all([
    db.from('business_profile').select('*').limit(1).maybeSingle(),
    db.from('business_brain_questions').select('question_key,status,answer,answer_source,answered_at,check_in_months'),
    db.from('business_knowledge').select('id,topic,title,kind,source_kind,status,confidence,last_checked_at,check_in_months,effective_until,updated_at').neq('status', 'forgotten'),
    db
      .from('business_brain_runs')
      .select('status,started_at,finished_at,coverage_before,coverage_after')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const firstError = profileRes.error || questionsRes.error || knowledgeRes.error || runRes.error
  if (isMissingBrainTables(firstError)) return null

  if (firstError) throw firstError

  return {
    profile: (profileRes.data as BrainProfileRow | null) ?? null,
    questions: (questionsRes.data as BrainQuestionRow[]) ?? [],
    knowledge: (knowledgeRes.data as BrainKnowledgeRow[]) ?? [],
    lastRun: (runRes.data as BrainRunRow | null) ?? null,
  }
}
