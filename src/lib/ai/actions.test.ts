/**
 * Tests for turning a request into a proposal.
 *
 * The rule under test: the parser recognises the three allowed actions and
 * refuses to guess when the product or the amount is missing.
 */

import { describe, it, expect } from 'vitest'
import { matchProduct, normalizeDigits, parseAmount, type ProductOption } from './actions'

const products: ProductOption[] = [
  {
    id: 'p1',
    name: 'مساحة ارضيات ببخاخ',
    name_ar: 'مساحة ارضيات ببخاخ',
    sku: 'EO-1',
    price: 315,
    cost_price: 0,
  },
  {
    id: 'p2',
    name: 'مساحة ارضيات',
    name_ar: null,
    sku: 'EO-2',
    price: 200,
    cost_price: 0,
  },
  {
    id: 'p3',
    name: 'بوتاجاز',
    name_ar: 'بوتاجاز',
    sku: 'EO-3',
    price: 1500,
    cost_price: 0,
  },
]

describe('digit and amount parsing', () => {
  it('normalises Arabic-Indic digits', () => {
    expect(normalizeDigits('٤٥ جنيه')).toBe('45 جنيه')
  })

  it('reads a plain amount', () => {
    expect(parseAmount('سجّل تكلفة المنتج ده بـ 45 جنيه')).toBe(45)
  })

  it('reads a decimal amount', () => {
    expect(parseAmount('التكلفة 45.50 جنيه')).toBe(45.5)
  })

  it('reads an amount written with Arabic-Indic digits', () => {
    expect(parseAmount('بـ ١٢٠ جنيه')).toBe(120)
  })

  it('returns null when there is no amount', () => {
    expect(parseAmount('سجّل تكلفة المنتج')).toBeNull()
  })
})

describe('product matching', () => {
  it('matches on the product name', () => {
    expect(matchProduct('سجّل تكلفة مساحة ارضيات ببخاخ بـ 45', products)?.id).toBe('p1')
  })

  it('prefers the LONGEST matching name', () => {
    // "مساحة ارضيات ببخاخ" contains "مساحة ارضيات" — the longer one wins.
    expect(matchProduct('مساحة ارضيات ببخاخ', products)?.id).toBe('p1')
  })

  it('matches on the SKU', () => {
    expect(matchProduct('سجّل تكلفة EO-3 بـ 90', products)?.id).toBe('p3')
  })

  it('returns null when the product is not mentioned', () => {
    expect(matchProduct('سجّل تكلفة شيء غير موجود بـ 45', products)).toBeNull()
  })
})
