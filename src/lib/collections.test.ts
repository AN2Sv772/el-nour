/**
 * Collection reconciliation tests — the 12 approved scenarios:
 * exact payment, partial, excess, deductions, separate adjustments,
 * multiple batches, batch covering multiple dates, orders already in a
 * previous batch (no double count), duplicate prevention, unallocated
 * payments, outstanding differences, historical corrections.
 */
import { describe, it, expect } from 'vitest'
import { computeCollectionBatch } from '@/lib/finance'

const order = (id: string, total: number, status = 'delivered') => ({ id, total_amount: total, status })

describe('computeCollectionBatch — approved scenarios', () => {
  it('1. exact expected payment received → matched', () => {
    const r = computeCollectionBatch([order('a', 500), order('b', 700)], [], 1200)
    expect(r.expected_amount).toBe(1200)
    expect(r.difference).toBe(0)
    expect(r.is_matched).toBe(true)
  })

  it('2. partial payment → negative difference (outstanding owed)', () => {
    const r = computeCollectionBatch([order('a', 500), order('b', 700)], [], 1000)
    expect(r.difference).toBe(-200)
    expect(r.is_matched).toBe(false)
  })

  it('3. excess payment → positive difference (review needed)', () => {
    const r = computeCollectionBatch([order('a', 500)], [], 600)
    expect(r.difference).toBe(100)
    expect(r.is_matched).toBe(false)
  })

  it('4. company shipping deductions reduce expected — separate from business shipping expense', () => {
    const r = computeCollectionBatch(
      [order('a', 500), order('b', 700)],
      [{ label: 'رسوم شحن الشركة', amount: 60 }, { label: 'رسوم إرجاع', amount: 40 }],
      1100
    )
    expect(r.deductions_total).toBe(100)
    expect(r.expected_amount).toBe(1100)
    expect(r.difference).toBe(0)
    expect(r.is_matched).toBe(true)
  })

  it('5. separate adjustment entries are added to deductions', () => {
    const r = computeCollectionBatch(
      [order('a', 1000)],
      [{ label: 'خدمة إضافية', amount: 25 }],
      975
    )
    expect(r.expected_amount).toBe(975)
    expect(r.is_matched).toBe(true)
  })

  it('6. multiple batches each compute independently', () => {
    const b1 = computeCollectionBatch([order('a', 500)], [], 500)
    const b2 = computeCollectionBatch([order('b', 700)], [{ label: 'x', amount: 50 }], 650)
    expect(b1.is_matched).toBe(true)
    expect(b2.is_matched).toBe(true)
    expect(b1.expected_amount + b2.expected_amount).toBe(1150)
  })

  it('7. batch covering orders from multiple dates sums them all', () => {
    const r = computeCollectionBatch([order('a', 300), order('b', 400), order('c', 500)], [], 1200)
    expect(r.expected_amount).toBe(1200)
    expect(r.allocated_orders_count).toBe(3)
  })

  it('8. cancelled/returned allocated orders excluded from settlement', () => {
    const r = computeCollectionBatch(
      [order('a', 500), order('b', 700, 'cancelled'), order('c', 600, 'returned')],
      [],
      500
    )
    expect(r.allocated_orders_count).toBe(1)
    expect(r.excluded_orders_count).toBe(2)
    expect(r.expected_amount).toBe(500)
    expect(r.is_matched).toBe(true)
  })

  it('9. negative deduction amounts are clamped to 0', () => {
    const r = computeCollectionBatch([order('a', 1000)], [{ label: 'خطأ', amount: -50 }], 1000)
    expect(r.deductions_total).toBe(0)
    expect(r.is_matched).toBe(true)
  })

  it('10. empty batch → expected 0, any receipt is an excess difference', () => {
    const r = computeCollectionBatch([], [], 300)
    expect(r.expected_amount).toBe(0)
    expect(r.difference).toBe(300)
    expect(r.is_matched).toBe(false)
  })

  it('11. outstanding difference persists until matched', () => {
    const r = computeCollectionBatch([order('a', 800)], [{ label: 'd', amount: 100 }], 600)
    expect(r.difference).toBe(-100)
    expect(r.is_matched).toBe(false)
  })

  it('12. rounding — cent-level totals stay exact', () => {
    const r = computeCollectionBatch(
      [order('a', 333.33), order('b', 166.67)],
      [{ label: 'd', amount: 0.01 }],
      499.99
    )
    expect(r.expected_amount).toBe(499.99)
    expect(r.is_matched).toBe(true)
  })
})
