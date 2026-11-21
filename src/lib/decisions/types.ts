/**
 * A decision the business owner can act on — with its evidence attached.
 *
 * WHY A "DECISION" AND NOT A "TIP"
 *
 * A tip is advice without a basis. Every decision here carries:
 *   - the NUMBERS that triggered it (from real rows),
 *   - the TABLES those numbers came from,
 *   - the CONFIDENCE the rule has (a rule that read a complete table is
 *     confident; a rule that read an approximation is not),
 *   - the ACTION, which is either a link to the page that fixes it or a
 *     PROPOSAL the owner approves before anything changes.
 *
 * The rules are deterministic — "Math before AI". An AI model may later
 * explain a decision in words; it may never invent one.
 */

import type { ApprovalActionType } from '@/lib/ai/approvals'

export type DecisionSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export type DecisionConfidence = 'high' | 'medium' | 'low'

export interface DecisionEvidence {
  label: string
  value: string
  /** The tables / settings the number was read from. */
  source: string[]
}

export interface DecisionProposal {
  type: ApprovalActionType
  title: string
  description: string
  payload: Record<string, unknown>
  impactSummary: string
}

export interface Decision {
  id: string
  severity: DecisionSeverity
  confidence: DecisionConfidence
  title: string
  /** The evidence in one sentence, with the numbers inside it. */
  why: string
  evidence: DecisionEvidence[]
  /** What changes if the decision is taken — null when it cannot be quantified. */
  impact: string | null
  action: {
    label: string
    href?: string
    proposal?: DecisionProposal
  }
  /** The rule that fired — for auditing the engine itself. */
  rule: string
}

export const SEVERITY_LABEL: Record<DecisionSeverity, string> = {
  critical: 'حرج',
  high: 'عالٍ',
  medium: 'متوسط',
  low: 'منخفض',
  info: 'معلومة',
}

export const SEVERITY_ORDER: Record<DecisionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}
