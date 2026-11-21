/**
 * Tests for the Brain's status and coverage logic.
 *
 * The rule under test: coverage measures what the OWNER answered, and the
 * status never claims "ready" while something still needs the owner.
 */

import { describe, it, expect } from 'vitest'
import {
  computeBrainStatus,
  computeCoverage,
  isMissingBrainTables,
  type BrainQuestionRow,
  type BrainKnowledgeRow,
  type BrainProfileRow,
} from './status'
import { BRAIN_QUESTIONS } from './questions'

const answered = (key: string): BrainQuestionRow => ({
  question_key: key,
  status: 'answered',
  answer: 'إجابة',
  answer_source: 'owner',
  answered_at: '2026-11-20T10:00:00.000Z',
  check_in_months: null,
})

const open = (key: string): BrainQuestionRow => ({
  question_key: key,
  status: 'open',
  answer: null,
  answer_source: 'owner',
  answered_at: null,
  check_in_months: null,
})

const profile: BrainProfileRow = {
  id: 'p1',
  business_name: 'El Nour',
  status: 'incomplete',
  primary_focus: 'profit',
  currency: 'EGP',
  timezone: 'Africa/Cairo',
  never_rules: ['لا خصم تحت 20%'],
  hard_constraints: ['لا شحن خارج مصر'],
  cash_floor: 10000,
  max_daily_ad_spend: 5000,
  goals_summary: 'زيادة الربح',
  updated_at: '2026-11-20T10:00:00.000Z',
}

describe('the Brain catalogue', () => {
  it('has unique question keys', () => {
    const keys = BRAIN_QUESTIONS.map(q => q.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('covers every area with at least one required question', () => {
    const areas = new Set(BRAIN_QUESTIONS.map(q => q.area))
    for (const area of areas) {
      const required = BRAIN_QUESTIONS.filter(q => q.area === area && q.required)
      expect(required.length).toBeGreaterThan(0)
    }
  })

  it('gives every question an Arabic prompt and a reason', () => {
    for (const q of BRAIN_QUESTIONS) {
      expect(q.prompt_ar.length).toBeGreaterThan(0)
      expect(q.why_it_matters.length).toBeGreaterThan(0)
    }
  })
})

describe('coverage', () => {
  it('is zero when nothing is answered', () => {
    const result = computeCoverage([])
    expect(result.coverage).toBe(0)
    expect(result.answered).toBe(0)
    expect(result.answerable).toBeGreaterThan(0)
  })

  it('counts only answered questions with a real answer', () => {
    const required = BRAIN_QUESTIONS.filter(q => q.required).slice(0, 4)
    const rows = [
      answered(required[0].key),
      { ...answered(required[1].key), answer: '   ' },
      open(required[2].key),
      { ...open(required[3].key), status: 'skipped' as const },
    ]
    const result = computeCoverage(rows)
    expect(result.answered).toBe(1)
    expect(result.coverage).toBe(Math.round((1 / result.answerable) * 100))
    expect(result.skippedRequired).toBe(1)
  })

  it('ignores answers to optional questions when computing coverage', () => {
    const optional = BRAIN_QUESTIONS.find(q => !q.required)!
    const result = computeCoverage([answered(optional.key)])
    expect(result.answered).toBe(0)
  })
})

describe('the Brain status', () => {
  it('is "not configured" without a profile', () => {
    const report = computeBrainStatus({ profile: null, questions: [], knowledge: [] })
    expect(report.status).toBe('not_configured')
    expect(report.gaps.some(g => g.kind === 'missing_profile')).toBe(true)
  })

  it('is "incomplete" while required questions are open', () => {
    const report = computeBrainStatus({ profile, questions: [], knowledge: [] })
    expect(report.status).toBe('incomplete')
    expect(report.openRequired).toBeGreaterThan(0)
  })

  it('is "ready" when every required question is answered and nothing conflicts', () => {
    const rows = BRAIN_QUESTIONS.filter(q => q.required).map(q => answered(q.key))
    const report = computeBrainStatus({ profile, questions: rows, knowledge: [] })
    expect(report.coverage).toBe(100)
    expect(report.status).toBe('ready')
  })

  it('is "needs attention" when knowledge conflicts', () => {
    const rows = BRAIN_QUESTIONS.filter(q => q.required).map(q => answered(q.key))
    const knowledge: BrainKnowledgeRow[] = [
      {
        id: 'k1',
        topic: 'costs',
        title: 'تكلفة المنتج',
        kind: 'fact',
        source_kind: 'owner',
        status: 'conflicted',
        confidence: 0.8,
        last_checked_at: '2026-11-20T10:00:00.000Z',
        check_in_months: null,
        effective_until: null,
        updated_at: '2026-11-20T10:00:00.000Z',
      },
    ]
    const report = computeBrainStatus({ profile, questions: rows, knowledge })
    expect(report.status).toBe('needs_attention')
    expect(report.gaps.some(g => g.kind === 'conflicted')).toBe(true)
  })

  it('is "outdated" when a knowledge item passed its check-in date', () => {
    const now = new Date('2026-11-20T12:00:00.000Z')
    const knowledge: BrainKnowledgeRow[] = [
      {
        id: 'k2',
        topic: 'pricing',
        title: 'هامش الربح',
        kind: 'fact',
        source_kind: 'owner',
        status: 'verified',
        confidence: 0.9,
        last_checked_at: '2025-01-01T10:00:00.000Z',
        check_in_months: 12,
        effective_until: null,
        updated_at: '2025-01-01T10:00:00.000Z',
      },
    ]
    const report = computeBrainStatus({ profile, questions: [], knowledge, now })
    expect(report.status).toBe('outdated')
    expect(report.gaps.some(g => g.kind === 'outdated')).toBe(true)
  })

  it('is "learning" while a run is in progress', () => {
    const report = computeBrainStatus({
      profile,
      questions: [],
      knowledge: [],
      lastRun: {
        status: 'running',
        started_at: '2026-11-20T10:00:00.000Z',
        finished_at: null,
        coverage_before: 40,
        coverage_after: null,
      },
    })
    expect(report.status).toBe('learning')
  })

  it('reports the area coverage', () => {
    const rows = BRAIN_QUESTIONS.filter(q => q.required && q.area === 'costs').map(q => answered(q.key))
    const report = computeBrainStatus({ profile, questions: rows, knowledge: [] })
    const costs = report.areas.find(a => a.key === 'costs')!
    expect(costs.coverage).toBe(100)
  })
})

describe('missing tables', () => {
  it('recognises a missing relation', () => {
    expect(isMissingBrainTables({ code: '42P01', message: 'relation does not exist' })).toBe(true)
  })

  it('does not swallow other errors', () => {
    expect(isMissingBrainTables({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isMissingBrainTables(null)).toBe(false)
  })
})
