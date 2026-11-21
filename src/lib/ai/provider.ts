/**
 * The AI provider abstraction.
 *
 * WHY
 * ---
 * The store has no AI provider configured today. This module is the seam
 * where one will be added, and it is written so that NOTHING breaks until
 * then: `getActiveProvider()` returns null, the chat route answers with the
 * deterministic tools instead, and the owner is told exactly what is missing.
 *
 * Rules that are not negotiable:
 *   1. The API key is NEVER returned to the browser and never logged.
 *   2. The key is stored encrypted (AES-256-GCM) with
 *      `CREDENTIALS_ENCRYPTION_KEY`; the plaintext key exists only in memory
 *      for the duration of a request.
 *   3. No provider is hardcoded as "the" provider — the owner chooses.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export type ProviderKind = 'openai_compatible' | 'anthropic' | 'gemini'

export interface ProviderSettings {
  id: string
  provider: ProviderKind
  label: string
  model: string
  base_url: string | null
  /** The encrypted key — never the plaintext. */
  api_key_ciphertext: string
  is_default: boolean
  max_tokens: number
  temperature: number
  request_limit_per_minute: number
  timeout_ms: number
  max_retries: number
  is_active: boolean
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface ProviderResponse {
  text: string
  model: string
  provider: ProviderKind
  inputTokens?: number
  outputTokens?: number
  latencyMs: number
}

export interface Provider {
  kind: ProviderKind
  label: string
  model: string
  chat(input: {
    messages: ChatMessage[]
    apiKey: string
    baseUrl: string | null
    model: string
    maxTokens: number
    temperature: number
    timeoutMs: number
  }): Promise<ProviderResponse>
}

/* ── Encryption ───────────────────────────────────────────────────────── */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

/** The key material: base64 (32 bytes) as-is, or a passphrase hashed to 32 bytes. */
function getEncryptionKey(): Buffer | null {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY
  if (!secret) return null
  const fromBase64 = Buffer.from(secret, 'base64')
  if (fromBase64.length === 32) return fromBase64
  return createHash('sha256').update(secret).digest()
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey()
  if (!key) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY غير مضبوط — لا يمكن حفظ مفتاح المزوّد. أضف 32 بايت base64 في .env.local.'
    )
  }
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptSecret(ciphertext: string): string {
  const key = getEncryptionKey()
  if (!key) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY غير مضبوط — لا يمكن فك تشفير مفتاح المزوّد.')
  }
  const parts = ciphertext.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('صيغة المفتاح المشفّر غير معروفة')
  }
  const iv = Buffer.from(parts[1], 'base64url')
  const tag = Buffer.from(parts[2], 'base64url')
  const data = Buffer.from(parts[3], 'base64url')
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function isEncryptionConfigured(): boolean {
  return getEncryptionKey() !== null
}

/* ── Provider implementations ─────────────────────────────────────────── */

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`انتهت المهلة بعد ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

const openAiCompatible: Provider = {
  kind: 'openai_compatible',
  label: 'OpenAI-compatible',
  model: '',
  async chat(input) {
    const started = Date.now()
    const base = (input.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
    const response = await withTimeout(
      fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          max_tokens: input.maxTokens,
          temperature: input.temperature,
        }),
      }),
      input.timeoutMs
    )

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new Error(body.error?.message ?? `المزوّد ردّ بـ ${response.status}`)
    }

    return {
      text: body.choices?.[0]?.message?.content ?? '',
      model: input.model,
      provider: 'openai_compatible',
      inputTokens: body.usage?.prompt_tokens,
      outputTokens: body.usage?.completion_tokens,
      latencyMs: Date.now() - started,
    }
  },
}

const anthropic: Provider = {
  kind: 'anthropic',
  label: 'Anthropic',
  model: '',
  async chat(input) {
    const started = Date.now()
    const base = (input.baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, '')
    const system = input.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
    const messages = input.messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))

    const response = await withTimeout(
      fetch(`${base}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': input.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: input.model,
          system: system || undefined,
          messages,
          max_tokens: input.maxTokens,
          temperature: input.temperature,
        }),
      }),
      input.timeoutMs
    )

    const body = (await response.json()) as {
      content?: { type: string; text?: string }[]
      usage?: { input_tokens?: number; output_tokens?: number }
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new Error(body.error?.message ?? `المزوّد ردّ بـ ${response.status}`)
    }

    return {
      text: body.content?.map(c => c.text ?? '').join('') ?? '',
      model: input.model,
      provider: 'anthropic',
      inputTokens: body.usage?.input_tokens,
      outputTokens: body.usage?.output_tokens,
      latencyMs: Date.now() - started,
    }
  },
}

const gemini: Provider = {
  kind: 'gemini',
  label: 'Gemini',
  model: '',
  async chat(input) {
    const started = Date.now()
    const base = (input.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')
    const contents = input.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    const system = input.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')

    const response = await withTimeout(
      fetch(
        `${base}/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            systemInstruction: system ? { parts: [{ text: system }] } : undefined,
            generationConfig: {
              maxOutputTokens: input.maxTokens,
              temperature: input.temperature,
            },
          }),
        }
      ),
      input.timeoutMs
    )

    const body = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new Error(body.error?.message ?? `المزوّد ردّ بـ ${response.status}`)
    }

    return {
      text: body.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '',
      model: input.model,
      provider: 'gemini',
      inputTokens: body.usageMetadata?.promptTokenCount,
      outputTokens: body.usageMetadata?.candidatesTokenCount,
      latencyMs: Date.now() - started,
    }
  },
}

export function providerFor(kind: ProviderKind): Provider {
  switch (kind) {
    case 'anthropic':
      return anthropic
    case 'gemini':
      return gemini
    case 'openai_compatible':
    default:
      return openAiCompatible
  }
}

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  openai_compatible: 'متوافق مع OpenAI (OpenRouter، Ollama، vLLM…)',
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
}
