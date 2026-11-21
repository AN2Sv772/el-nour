import { describe, it, expect } from 'vitest'
import {
  DICTIONARY_FOR_TEST,
  assertDictionary,
  createTranslator,
  DIRECTION,
  LANGUAGE_LABEL,
} from '@/lib/i18n/language'

/**
 * The dictionary is a contract between the Arabic and the English UI. A key
 * that exists in one language and not the other would silently render Arabic
 * copy inside an English shell — the kind of defect no screenshot review
 * catches until a user in the wrong language opens the app.
 */
describe('i18n dictionary', () => {
  it('has the same keys in both languages', () => {
    expect(() => assertDictionary()).not.toThrow()
  })

  it('has no empty strings', () => {
    for (const [language, table] of Object.entries(DICTIONARY_FOR_TEST)) {
      for (const [key, value] of Object.entries(table)) {
        expect(`${language}:${key}:${String(value).trim()}`).toBe(`${language}:${key}:${String(value).trim()}`)
        expect(String(value).trim().length, `${language}:${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('translates to the requested language and falls back to Arabic', () => {
    const ar = createTranslator('ar')
    const en = createTranslator('en')

    expect(ar('nav.orders')).toBe('الطلبات')
    expect(en('nav.orders')).toBe('Orders')

    // An unknown key returns the key itself rather than an empty string —
    // a visible placeholder is better than a blank label.
    // (`as never` is the deliberate way of asking for a key that does not exist.)
    expect(en('nav.does-not-exist' as never)).toBe('nav.does-not-exist')
  })

  it('maps each language to a direction and a label', () => {
    expect(DIRECTION.ar).toBe('rtl')
    expect(DIRECTION.en).toBe('ltr')
    expect(LANGUAGE_LABEL.ar).toBe('العربية')
    expect(LANGUAGE_LABEL.en).toBe('English')
  })
})
