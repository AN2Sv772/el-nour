import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getInternalTriggerSecret, isValidInternalTrigger } from '@/lib/easyorders/internal-trigger'

describe('internal trigger secret', () => {
  const originalKey = process.env.CREDENTIALS_ENCRYPTION_KEY
  const originalOverride = process.env.INTERNAL_TRIGGER_SECRET

  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-encryption-key'
    delete process.env.INTERNAL_TRIGGER_SECRET
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY
    else process.env.CREDENTIALS_ENCRYPTION_KEY = originalKey
    if (originalOverride === undefined) delete process.env.INTERNAL_TRIGGER_SECRET
    else process.env.INTERNAL_TRIGGER_SECRET = originalOverride
  })

  it('derives a stable secret from the server key', () => {
    const a = getInternalTriggerSecret()
    const b = getInternalTriggerSecret()
    expect(a).toBeTruthy()
    expect(a).toBe(b)
    expect(a).toHaveLength(64) // sha256 hex
  })

  it('accepts only the exact derived secret', () => {
    const secret = getInternalTriggerSecret()!
    expect(isValidInternalTrigger(secret)).toBe(true)
    // The old fixed header must no longer work.
    expect(isValidInternalTrigger('webhook')).toBe(false)
    expect(isValidInternalTrigger('')).toBe(false)
    expect(isValidInternalTrigger(null)).toBe(false)
    expect(isValidInternalTrigger(undefined)).toBe(false)
    expect(isValidInternalTrigger(secret + 'x')).toBe(false)
    expect(isValidInternalTrigger(secret.slice(0, -1))).toBe(false)
  })

  it('produces different secrets for different server keys', () => {
    const first = getInternalTriggerSecret()
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'a-different-key'
    expect(getInternalTriggerSecret()).not.toBe(first)
  })

  it('fails closed when no server secret is configured', () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY
    delete process.env.INTERNAL_TRIGGER_SECRET
    expect(getInternalTriggerSecret()).toBeNull()
    expect(isValidInternalTrigger('anything')).toBe(false)
  })

  it('prefers an explicit override over the encryption key', () => {
    process.env.INTERNAL_TRIGGER_SECRET = 'explicit-secret'
    const withOverride = getInternalTriggerSecret()
    expect(withOverride).toBeTruthy()
    expect(isValidInternalTrigger(withOverride)).toBe(true)
  })
})
