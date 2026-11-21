/**
 * Date presets for the date filtering system.
 * Uses Africa/Cairo timezone (Egypt business timezone).
 */

export interface DatePreset {
  label: string
  value: string
  getDateRange: () => { from: string; to: string }
}

function toISO(d: Date): string {
  return d.toISOString().split('T')[0]
}

function startOfDay(d: Date): Date {
  const d2 = new Date(d)
  d2.setHours(0, 0, 0, 0)
  return d2
}

function endOfDay(d: Date): Date {
  const d2 = new Date(d)
  d2.setHours(23, 59, 59, 999)
  return d2
}

export const DATE_PRESETS: DatePreset[] = [
  {
    label: 'اليوم',
    value: 'today',
    getDateRange: () => {
      const now = new Date()
      return { from: toISO(startOfDay(now)), to: toISO(endOfDay(now)) }
    }
  },
  {
    label: 'أمس',
    value: 'yesterday',
    getDateRange: () => {
      const yesterday = new Date(Date.now() - 86400000)
      return { from: toISO(startOfDay(yesterday)), to: toISO(endOfDay(yesterday)) }
    }
  },
  {
    label: 'هذا الأسبوع',
    value: 'this_week',
    getDateRange: () => {
      const now = new Date()
      const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()))
      return { from: toISO(startOfDay(start)), to: toISO(endOfDay(new Date())) }
    }
  },
  {
    label: 'الأسبوع الماضي',
    value: 'last_week',
    getDateRange: () => {
      const now = new Date()
      const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()))
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 1)
      return { from: toISO(startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7))), to: toISO(endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 1))) }
    }
  },
  {
    label: 'هذا الشهر',
    value: 'this_month',
    getDateRange: () => {
      const now = new Date()
      return { from: toISO(startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))), to: toISO(endOfDay(new Date())) }
    }
  },
  {
    label: 'الشهر الماضي',
    value: 'last_month',
    getDateRange: () => {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: toISO(startOfDay(start)), to: toISO(endOfDay(end)) }
    }
  },
  {
    label: 'آخر 7 أيام',
    value: 'last_7_days',
    getDateRange: () => {
      const now = new Date()
      return { from: toISO(startOfDay(new Date(Date.now() - 6 * 86400000))), to: toISO(endOfDay(new Date())) }
    }
  },
  {
    label: 'آخر 30 يوم',
    value: 'last_30_days',
    getDateRange: () => {
      const now = new Date()
      return { from: toISO(startOfDay(new Date(Date.now() - 29 * 86400000))), to: toISO(endOfDay(new Date())) }
    }
  },
  {
    label: 'هذا العام',
    value: 'this_year',
    getDateRange: () => {
      const now = new Date()
      return { from: toISO(startOfDay(new Date(now.getFullYear(), 0, 1))), to: toISO(endOfDay(new Date())) }
    }
  },
  {
    label: 'كل الفترات',
    value: 'all',
    getDateRange: () => ({ from: '', to: '' })
  }
]