import { describe, it, expect } from 'vitest'
import { buildBriefing } from './briefing'

const base = {
  date: '2026-11-21',
  today: { orders: 12, revenue: 4800, delivered: 0, profit: null },
  period: { label: 'آخر 30 يومًا', revenue: 315560, orders: 741, profit: null },
  risks: [] as { id: string; severity: string; title: string; why: string; href?: string }[],
  anomalies: [] as { id: string; severity: string; title: string; what: string; href?: string }[],
  missing: [] as { label: string; reason: string; href?: string }[],
}

describe('buildBriefing', () => {
  it('summarises today without inventing a profit', () => {
    const result = buildBriefing(base)
    expect(result.lines[0].text).toContain('12')
    expect(result.lines.find(l => l.key === 'profit')!.text).toContain('محجوب')
    expect(result.tasks.find(t => t.id === 'task_follow_up_delivery')).toBeDefined()
  })

  it('publishes the profit when it is real', () => {
    const result = buildBriefing({
      ...base,
      today: { orders: 12, revenue: 4800, delivered: 3, profit: 900 },
      period: { label: 'آخر 30 يومًا', revenue: 315560, orders: 741, profit: 25000 },
    })
    const profitLine = result.lines.find(l => l.key === 'profit')!
    expect(profitLine.text).toContain('25000')
    expect(profitLine.severity).toBe('good')
  })

  it('turns critical anomalies into urgent tasks that require approval', () => {
    const result = buildBriefing({
      ...base,
      anomalies: [
        { id: 'no_deliveries', severity: 'critical', title: 'لا يوجد أي طلب مُسلَّم', what: '741 طلب' },
      ],
    })
    const task = result.tasks.find(t => t.id === 'task_anomaly_no_deliveries')!
    expect(task.priority).toBe('urgent')
    expect(task.requiresApproval).toBe(true)
    expect(result.headline).toContain('حرجة')
  })

  it('never produces two tasks with the same id (an anomaly and a decision can share a base id)', () => {
    const result = buildBriefing({
      ...base,
      anomalies: [
        { id: 'no_deliveries', severity: 'critical', title: 'لا يوجد أي طلب مُسلَّم', what: '741 طلب' },
      ],
      risks: [
        { id: 'no_deliveries', severity: 'critical', title: 'لا يوجد أي طلب مُسلَّم', why: '741 طلب' },
      ],
    })
    const ids = result.tasks.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('task_anomaly_no_deliveries')
    expect(ids).toContain('task_decision_no_deliveries')
  })

  it('lists the data it could not use', () => {
    const result = buildBriefing({
      ...base,
      missing: [{ label: 'تكلفة المنتجات', reason: '12 منتج بدون تكلفة', href: '/setup/costs' }],
    })
    expect(result.blindSpots[0]).toContain('تكلفة المنتجات')
    expect(result.tasks.some(t => t.id === 'task_missing_تكلفة المنتجات')).toBe(true)
  })

  it('never produces a task without an owner and a due date', () => {
    const result = buildBriefing({
      ...base,
      risks: [{ id: 'r1', severity: 'high', title: 'تراكم الطلبات', why: '1257 طلب' }],
    })
    for (const task of result.tasks) {
      expect(task.assignee).toBeTruthy()
      expect(task.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(task.suggestedAction.length).toBeGreaterThan(5)
    }
  })

  it('says there is nothing critical when there is nothing critical', () => {
    const result = buildBriefing({
      ...base,
      today: { orders: 5, revenue: 2000, delivered: 5, profit: 700 },
      period: { label: 'آخر 30 يومًا', revenue: 315560, orders: 741, profit: 25000 },
    })
    expect(result.headline).toContain('لا شيء حرج')
  })
})
