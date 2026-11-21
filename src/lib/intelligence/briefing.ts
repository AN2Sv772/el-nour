/**
 * Daily briefing — the autopilot that speaks first.
 *
 * The owner should not have to ask. Every morning the system should be able
 * to say what happened, what is at risk, and what needs a human decision.
 *
 * Two constraints shape the design:
 *   1. Every line is backed by a number from a real record. If the number is
 *      missing, the line says the data is missing — it never invents urgency.
 *   2. Every action it suggests is a TASK, not an execution. The autopilot
 *      prepares; a human approves. That is the product's core promise.
 */

export type BriefingSeverity = 'critical' | 'warning' | 'info' | 'good'

export interface BriefingLine {
  key: string
  severity: BriefingSeverity
  text: string
  /** The numbers behind the sentence. */
  evidence: string[]
  href?: string
}

export interface BriefingTask {
  id: string
  title: string
  description: string
  priority: 'urgent' | 'high' | 'normal'
  /** Who should do it. */
  assignee: 'owner' | 'finance' | 'operations' | 'marketing' | 'employee'
  /** ISO date. */
  dueDate: string
  evidence: string[]
  /** The suggested action — a proposal, never an automatic execution. */
  suggestedAction: string
  /** True when the action changes business data (so it needs approval). */
  requiresApproval: boolean
  href?: string
}

export interface BriefingResult {
  /** The date the briefing is about (Cairo business day). */
  date: string
  greeting: string
  headline: string
  lines: BriefingLine[]
  tasks: BriefingTask[]
  /** What the briefing could NOT say, and why. */
  blindSpots: string[]
}

export interface BriefingInput {
  date: string
  /** Today's numbers. */
  today: {
    orders: number
    revenue: number | null
    delivered: number
    profit: number | null
  }
  /** The period the business is judged on. */
  period: {
    label: string
    revenue: number | null
    orders: number
    profit: number | null
  }
  /** Items that need attention, from the decisions engine. */
  risks: { id: string; severity: string; title: string; why: string; href?: string }[]
  /** Items that are broken, from the anomaly engine. */
  anomalies: { id: string; severity: string; title: string; what: string; href?: string }[]
  /** Data the briefing could not use. */
  missing: { label: string; reason: string; href?: string }[]
}

function isoAddDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Build the daily briefing. */
export function buildBriefing(input: BriefingInput): BriefingResult {
  const lines: BriefingLine[] = []
  const tasks: BriefingTask[] = []

  /* Today */
  lines.push({
    key: 'today',
    severity: input.today.orders > 0 ? 'good' : 'info',
    text:
      input.today.orders > 0
        ? `اليوم ${input.today.orders} طلب بقيمة ${input.today.revenue !== null ? Math.round(input.today.revenue) + ' ج.م' : 'غير محسوبة'}`
        : 'لم يُسجَّل أي طلب اليوم بعد',
    evidence: [
      `الطلبات: ${input.today.orders}`,
      `المبيعات: ${input.today.revenue !== null ? Math.round(input.today.revenue) : '—'}`,
      `المسلَّم: ${input.today.delivered}`,
    ],
  })

  /* Profit */
  if (input.period.profit !== null) {
    lines.push({
      key: 'profit',
      severity: input.period.profit >= 0 ? 'good' : 'critical',
      text: `صافي ربح ${input.period.label}: ${Math.round(input.period.profit)} ج.م`,
      evidence: ['محسوب من سجلات كاملة'],
    })
  } else {
    lines.push({
      key: 'profit',
      severity: 'warning',
      text: `صافي ربح ${input.period.label} محجوب — التكاليف غير مسجّلة بالكامل`,
      evidence: ['لا يُعرض رقم ناقص على أنه ربح'],
      href: '/setup/costs',
    })
  }

  /* Delivery */
  lines.push({
    key: 'delivery',
    severity: input.today.delivered > 0 ? 'good' : 'warning',
    text:
      input.today.delivered > 0
        ? `${input.today.delivered} طلب تم تسليمه اليوم`
        : 'لا يوجد طلب مُسلَّم اليوم — راجع حالة الطلبات والتكامل',
    evidence: [`المسلَّم اليوم: ${input.today.delivered}`],
    href: '/orders',
  })

  /* Risks from the decisions engine */
  for (const risk of input.risks.slice(0, 4)) {
    const severity: BriefingSeverity =
      risk.severity === 'critical' ? 'critical' : risk.severity === 'high' ? 'warning' : 'info'
    lines.push({
      key: `risk_${risk.id}`,
      severity,
      text: risk.title,
      evidence: [risk.why],
      href: risk.href,
    })
  }

  /* Anomalies */
  for (const anomaly of input.anomalies.slice(0, 3)) {
    const severity: BriefingSeverity =
      anomaly.severity === 'critical' ? 'critical' : anomaly.severity === 'warning' ? 'warning' : 'info'
    lines.push({
      key: `anomaly_${anomaly.id}`,
      severity,
      text: anomaly.title,
      evidence: [anomaly.what],
      href: anomaly.href,
    })
  }

  /* Tasks — proposals only. */
  for (const anomaly of input.anomalies) {
    if (anomaly.severity === 'critical') {
      tasks.push({
        // Namespaced: an anomaly and a decision may carry the same base id
        // (both can say "no_deliveries"), and the task id must stay unique
        // or React will drop one of the two rows.
        id: `task_anomaly_${anomaly.id}`,
        title: anomaly.title,
        description: anomaly.what,
        priority: 'urgent',
        assignee: 'operations',
        dueDate: isoAddDays(input.date, 0),
        evidence: [anomaly.title],
        suggestedAction: anomaly.href
          ? 'افتح السجل المرتبط وتحقق من السبب قبل أي تعديل'
          : 'تحقق من السجلات المرتبطة',
        requiresApproval: true,
        href: anomaly.href,
      })
    }
  }

  for (const risk of input.risks) {
    if (risk.severity === 'critical' || risk.severity === 'high') {
      tasks.push({
        id: `task_decision_${risk.id}`,
        title: risk.title,
        description: risk.why,
        priority: risk.severity === 'critical' ? 'urgent' : 'high',
        assignee: 'owner',
        dueDate: isoAddDays(input.date, risk.severity === 'critical' ? 0 : 2),
        evidence: [risk.why],
        suggestedAction: 'راجع القرار في صفحة القرارات — أي تنفيذ يحتاج موافقتك',
        requiresApproval: true,
        href: risk.href ?? '/decisions',
      })
    }
  }

  if (input.today.orders > 0 && input.today.delivered === 0) {
    tasks.push({
      id: 'task_follow_up_delivery',
      title: 'متابعة تسليم طلبات اليوم',
      description: `${input.today.orders} طلب اليوم ولم يُسجَّل تسليم واحد`,
      priority: 'high',
      assignee: 'operations',
      dueDate: isoAddDays(input.date, 1),
      evidence: [`طلبات اليوم: ${input.today.orders}`, 'التسليمات: 0'],
      suggestedAction: 'راجع حالة الطلبات في EasyOrders — لا تغيّر حالة الطلب يدويًا',
      requiresApproval: false,
      href: '/orders',
    })
  }

  for (const gap of input.missing) {
    tasks.push({
      id: `task_missing_${gap.label}`,
      title: `تسجيل: ${gap.label}`,
      description: gap.reason,
      priority: 'high',
      assignee: 'finance',
      dueDate: isoAddDays(input.date, 3),
      evidence: [gap.reason],
      suggestedAction: 'أكمل التسجيل — الأرقام المحجوبة تُفتح تلقائيًا بعده',
      requiresApproval: false,
      href: gap.href,
    })
  }

  const criticalCount = lines.filter(l => l.severity === 'critical').length
  const warningCount = lines.filter(l => l.severity === 'warning').length

  const headline =
    criticalCount > 0
      ? `${criticalCount} مشكلة حرجة تحتاج انتباهك اليوم`
      : warningCount > 0
        ? `${warningCount} نقطة تحتاج متابعة`
        : 'لا شيء حرج اليوم — التفاصيل أدناه'

  // The invariant: task ids are unique. Two sources (anomalies and
  // decisions) can describe the same problem with the same base id, and a
  // duplicated React key silently drops a row from the owner's briefing.
  const seen = new Set<string>()
  const uniqueTasks = tasks.map(task => {
    if (!seen.has(task.id)) {
      seen.add(task.id)
      return task
    }
    let suffix = 2
    let candidate = `${task.id}_${suffix}`
    while (seen.has(candidate)) {
      suffix += 1
      candidate = `${task.id}_${suffix}`
    }
    seen.add(candidate)
    return { ...task, id: candidate }
  })

  return {
    date: input.date,
    greeting: 'صباح الخير — هذه حالة البيزنس اليوم',
    headline,
    lines,
    tasks: uniqueTasks,
    blindSpots: input.missing.map(m => `${m.label}: ${m.reason}`),
  }
}
