import { describe, it, expect, vi } from 'vitest'
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPhoneNumber,
  normalizePhoneNumber,
  normalizePhoneForStorage,
  fitToColumn,
  MAX_PHONE_LENGTH,
  generateOrderNumber,
  debounce,
  statusColors,
} from '@/lib/utils'

describe('formatCurrency', () => {
  it('formats a number the way an Egyptian owner reads it', () => {
    const result = formatCurrency(100)
    expect(result).toContain('ج.م')
    expect(result).toContain('100')
    expect(result).not.toContain('E£')
  })

  it('uses Latin digits everywhere (the dashboard and the cockpit must not disagree)', () => {
    const result = formatCurrency(315880.5)
    // Arabic-Indic digits (٣١٥) would make the same number look like two
    // different numbers on two different screens.
    expect(result).toContain('315,880.5')
    expect(result).not.toMatch(/[\u0660-\u0669]/)
  })

  it('handles zero', () => {
    const result = formatCurrency(0)
    expect(result).toContain('ج.م')
  })

  it('handles decimal amounts', () => {
    const result = formatCurrency(99.99)
    expect(result).toContain('99.99')
    expect(result).toContain('ج.م')
  })

  it('keeps a non-EGP currency as its code', () => {
    expect(formatCurrency(10, 'USD')).toContain('USD')
  })
})

describe('formatDate', () => {
  it('formats a date string in Arabic locale', () => {
    const result = formatDate('2024-01-15T10:30:00Z')
    expect(result).toContain('يناير')
  })
})

describe('formatDateTime', () => {
  it('formats date and time in Arabic locale', () => {
    const result = formatDateTime('2024-01-15T10:30:00Z')
    expect(result).toContain('يناير')
    expect(result).toMatch(/12:30/)
  })
})

describe('formatPhoneNumber', () => {
  it('formats Egyptian number starting with 20', () => {
    expect(formatPhoneNumber('201234567890')).toBe('+201234567890')
  })

  it('formats Egyptian number starting with 0', () => {
    expect(formatPhoneNumber('01234567890')).toBe('+201234567890')
  })

  it('formats number without prefix', () => {
    expect(formatPhoneNumber('1234567890')).toBe('+201234567890')
  })
})

describe('normalizePhoneNumber', () => {
  it('normalizes Egyptian numbers with +20 prefix', () => {
    expect(normalizePhoneNumber('+201234567890')).toBe('+201234567890')
    expect(normalizePhoneNumber('01234567890')).toBe('+201234567890')
    expect(normalizePhoneNumber('201234567890')).toBe('+201234567890')
    expect(normalizePhoneNumber('1234567890')).toBe('+201234567890')
  })

  it('normalizes international numbers with + prefix', () => {
    expect(normalizePhoneNumber('1234567890123')).toBe('+1234567890123')
    expect(normalizePhoneNumber('+1234567890123')).toBe('+1234567890123')
  })
})

describe('generateOrderNumber', () => {
  it('generates an order number with ORD prefix', () => {
    const orderNumber = generateOrderNumber()
    expect(orderNumber).toMatch(/^ORD-\d{6}-\d{4}$/)
  })

  it('generates unique order numbers', () => {
    const num1 = generateOrderNumber()
    const num2 = generateOrderNumber()
    expect(num1).not.toBe(num2)
  })
})

describe('debounce', () => {
  it('delays function execution', async () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    
    debounced('a')
    debounced('b')
    debounced('c')
    
    expect(fn).not.toHaveBeenCalled()
    
    await new Promise(resolve => setTimeout(resolve, 150))
    
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')
  })
})

describe('normalizePhoneForStorage', () => {
  it('leaves a normal Egyptian number untouched', () => {
    expect(normalizePhoneForStorage('01234567890')).toBe('+201234567890')
    expect(normalizePhoneForStorage('01234567890').length).toBeLessThanOrEqual(MAX_PHONE_LENGTH)
  })

  it('fits a long international number into customers.phone (VARCHAR(20))', () => {
    // A 25-digit number overflowed the column → 22001 → the whole order
    // import was lost. It must always fit now.
    const long = '+1234567890123456789012345'
    const stored = normalizePhoneForStorage(long)
    expect(stored.length).toBeLessThanOrEqual(MAX_PHONE_LENGTH)
    expect(stored.startsWith('+12')).toBe(true)
  })

  it('always returns something that fits the column', () => {
    for (const p of ['+1', '009627777777777', '00000000000000000000000000000', '+2012345678901234567890']) {
      expect(normalizePhoneForStorage(p).length).toBeLessThanOrEqual(MAX_PHONE_LENGTH)
    }
  })
})

describe('fitToColumn', () => {
  it('leaves a value that already fits untouched', () => {
    expect(fitToColumn('E2E-TEST-001', 100)).toBe('E2E-TEST-001')
  })

  it('shortens an over-long value to the column width', () => {
    const long = 'x'.repeat(300)
    const fitted = fitToColumn(long, 100)
    expect(fitted.length).toBe(100)
    expect(fitted).not.toBe(long)
  })

  it('keeps distinct values distinct after shortening', () => {
    const a = fitToColumn('product-name-alpha-' + 'x'.repeat(200), 100)
    const b = fitToColumn('product-name-beta-' + 'x'.repeat(200), 100)
    expect(a).not.toBe(b)
  })

  it('is deterministic', () => {
    const v = 'y'.repeat(250)
    expect(fitToColumn(v, 100)).toBe(fitToColumn(v, 100))
  })
})

describe('statusColors', () => {
  it('returns color config for all order statuses', () => {
    expect(statusColors.pending).toBeDefined()
    expect(statusColors.confirmed).toBeDefined()
    expect(statusColors.delivered).toBeDefined()
    expect(statusColors.cancelled).toBeDefined()
    expect(statusColors.returned).toBeDefined()
  })

  it('has bg, text, icon, and iconColor properties', () => {
    const status = statusColors.pending
    expect(status.bg).toBeDefined()
    expect(status.text).toBeDefined()
    expect(status.icon).toBeDefined()
    expect(status.iconColor).toBeDefined()
  })
})
