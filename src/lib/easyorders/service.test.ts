import { describe, it, expect } from 'vitest'
import { easyOrdersSyncService } from '@/lib/easyorders/sync'

describe('EasyOrdersSyncService normalizePhoneForEasyOrders', () => {
  it('normalizes Egyptian numbers with 20 prefix', () => {
    expect(easyOrdersSyncService.normalizePhoneForEasyOrders('201234567890')).toBe('+201234567890')
  })

  it('normalizes Egyptian numbers with 0 prefix', () => {
    expect(easyOrdersSyncService.normalizePhoneForEasyOrders('01234567890')).toBe('+201234567890')
  })

  it('normalizes numbers without country code', () => {
    expect(easyOrdersSyncService.normalizePhoneForEasyOrders('1234567890')).toBe('+201234567890')
  })

  it('handles international numbers', () => {
    expect(easyOrdersSyncService.normalizePhoneForEasyOrders('1234567890123')).toBe('+1234567890123')
  })
})
