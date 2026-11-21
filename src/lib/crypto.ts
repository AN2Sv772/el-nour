import crypto from 'crypto'

/**
 * Server-side credential encryption using AES-256-GCM (authenticated encryption).
 *
 * Requirements:
 *   CREDENTIALS_ENCRYPTION_KEY — 64 hex chars (32 bytes) or any string that gets hashed to 32 bytes.
 *   Rotate by setting CREDENTIALS_ENCRYPTION_KEY_OLD and reading both during decrypt.
 */

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest()
}

function getEncryptionKey(): Buffer {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY
  if (!key) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32'
    )
  }
  return deriveKey(key)
}

function getLegacyKey(): Buffer | null {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY_OLD
  if (!key) return null
  return deriveKey(key)
}

/**
 * Encrypt a plaintext secret. Returns "v1:<iv_hex>:<ciphertext_hex>:<auth_tag_hex>".
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGO, key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()

  return `v1:${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`
}

/**
 * Decrypt a secret encrypted with encryptSecret().
 * Falls back to the legacy key if the current key fails (key rotation support).
 */
export function decryptSecret(encrypted: string): string {
  const parts = encrypted.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted secret format')
  }

  const [, ivHex, ciphertextHex, authTagHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  // Try current key first
  try {
    const key = getEncryptionKey()
    const decipher = crypto.createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(authTag)
    let decrypted = decipher.update(ciphertext, undefined, 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch {
    // Try legacy key (rotation)
    const legacyKey = getLegacyKey()
    if (legacyKey) {
      const decipher = crypto.createDecipheriv(ALGO, legacyKey, iv)
      decipher.setAuthTag(authTag)
      let decrypted = decipher.update(ciphertext, undefined, 'utf8')
      decrypted += decipher.final('utf8')
      return decrypted
    }
    throw new Error('Failed to decrypt secret. Check CREDENTIALS_ENCRYPTION_KEY.')
  }
}

/**
 * Mask a secret for display: show first 4 and last 4 chars only.
 */
export function maskSecret(secret: string): string {
  if (!secret || secret.length < 8) return '••••••••'
  return `${secret.slice(0, 4)}${'•'.repeat(Math.min(12, secret.length - 8))}${secret.slice(-4)}`
}

/**
 * Generate a new encryption key (for initial setup).
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex')
}
