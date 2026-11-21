// @vitest-environment node
/**
 * Provider verification WITHOUT a fabricated key.
 *
 * The owner has no AI provider configured yet, so the live path cannot be
 * exercised against a real vendor. What CAN be verified — and is verified
 * here — is everything the app owns: the request shape, the response parsing,
 * the error propagation, the timeout, and the encryption of the key at rest.
 * A local mock server stands in for the vendor; no secret is invented and no
 * external request is made.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
// The encryption key is a server-side secret; the test process does not load
// .env.local, so the suite sets a throwaway key of its own.
process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-only-encryption-key-32-bytes!'

import {
  providerFor,
  encryptSecret,
  decryptSecret,
  isEncryptionConfigured,
} from './provider'

let server: Server
let baseUrl: string
let lastRequest: { url: string; headers: Record<string, string>; body: any } | null = null
let nextStatus = 200
let nextDelayMs = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body: any = null
      try {
        body = JSON.parse(raw)
      } catch {
        body = raw
      }
      lastRequest = { url: req.url ?? '', headers: req.headers as Record<string, string>, body }

      const respond = () => {
        if (nextStatus !== 200) {
          res.writeHead(nextStatus, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'المفتاح مرفوض' } }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (req.url?.includes('/messages')) {
          res.end(
            JSON.stringify({
              content: [{ type: 'text', text: 'رد Anthropic التجريبي' }],
              usage: { input_tokens: 11, output_tokens: 7 },
            }),
          )
        } else {
          res.end(
            JSON.stringify({
              choices: [{ message: { content: 'رد OpenAI التجريبي' } }],
              usage: { prompt_tokens: 11, completion_tokens: 7 },
            }),
          )
        }
      }
      if (nextDelayMs > 0) setTimeout(respond, nextDelayMs)
      else respond()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('providerFor', () => {
  it('returns a provider for every supported kind', () => {
    expect(providerFor('openai_compatible').kind).toBe('openai_compatible')
    expect(providerFor('anthropic').kind).toBe('anthropic')
    expect(providerFor('gemini').kind).toBe('gemini')
  })
})

describe('OpenAI-compatible provider', () => {
  it('sends the model, the messages and the bearer key, then parses the answer', async () => {
    nextStatus = 200
    nextDelayMs = 0
    const provider = providerFor('openai_compatible')
    const response = await provider.chat({
      messages: [
        { role: 'system', content: 'أنت مساعد محل' },
        { role: 'user', content: 'كم مبيعاتي؟' },
      ],
      apiKey: 'test-local-key',
      baseUrl,
      model: 'local-model',
      maxTokens: 256,
      temperature: 0.2,
      timeoutMs: 5000,
    })

    expect(response.text).toBe('رد OpenAI التجريبي')
    expect(response.model).toBe('local-model')
    expect(response.inputTokens).toBe(11)
    expect(response.outputTokens).toBe(7)

    expect(lastRequest?.url).toBe('/chat/completions')
    expect(lastRequest?.headers.authorization).toBe('Bearer test-local-key')
    expect(lastRequest?.body.model).toBe('local-model')
    expect(lastRequest?.body.max_tokens).toBe(256)
    expect(lastRequest?.body.messages).toHaveLength(2)
  })

  it('propagates the provider error message instead of pretending it worked', async () => {
    nextStatus = 401
    try {
      await providerFor('openai_compatible').chat({
        messages: [{ role: 'user', content: 'x' }],
        apiKey: 'wrong',
        baseUrl,
        model: 'local-model',
        maxTokens: 16,
        temperature: 0,
        timeoutMs: 5000,
      })
      throw new Error('كان يجب أن يفشل الطلب')
    } catch (err) {
      expect((err as Error).message).toContain('المفتاح مرفوض')
    } finally {
      nextStatus = 200
    }
  })

  it('gives up when the provider is slower than the timeout', async () => {
    nextDelayMs = 300
    try {
      await providerFor('openai_compatible').chat({
        messages: [{ role: 'user', content: 'x' }],
        apiKey: 'test-local-key',
        baseUrl,
        model: 'local-model',
        maxTokens: 16,
        temperature: 0,
        timeoutMs: 80,
      })
      throw new Error('كان يجب أن تنتهي المهلة')
    } catch (err) {
      expect((err as Error).message).toContain('انتهت المهلة')
    } finally {
      nextDelayMs = 0
    }
  })
})

describe('Anthropic provider', () => {
  it('splits the system prompt out of the messages and reads the content blocks', async () => {
    const provider = providerFor('anthropic')
    const response = await provider.chat({
      messages: [
        { role: 'system', content: 'قاعدة المتجر' },
        { role: 'user', content: 'حلّل المبيعات' },
      ],
      apiKey: 'test-local-key',
      baseUrl,
      model: 'claude-local',
      maxTokens: 512,
      temperature: 0.1,
      timeoutMs: 5000,
    })

    expect(response.text).toBe('رد Anthropic التجريبي')
    expect(response.provider).toBe('anthropic')
    expect(lastRequest?.url).toBe('/messages')
    expect(lastRequest?.headers['x-api-key']).toBe('test-local-key')
    expect(lastRequest?.headers['anthropic-version']).toBe('2023-06-01')
    expect(lastRequest?.body.system).toBe('قاعدة المتجر')
    expect(lastRequest?.body.messages).toHaveLength(1)
  })
})

describe('credential encryption', () => {
  it('round-trips the key without ever storing it in clear text', () => {
    const secret = 'sk-live-super-secret-value'
    const cipher = encryptSecret(secret)
    expect(cipher.startsWith('v1.')).toBe(true)
    expect(cipher).not.toContain(secret)
    expect(decryptSecret(cipher)).toBe(secret)
  })

  it('produces a different ciphertext every time (random IV)', () => {
    const a = encryptSecret('same-key')
    const b = encryptSecret('same-key')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe(decryptSecret(b))
  })

  it('refuses to decrypt with the wrong key', () => {
    const cipher = encryptSecret('secret')
    const original = process.env.CREDENTIALS_ENCRYPTION_KEY
    try {
      process.env.CREDENTIALS_ENCRYPTION_KEY = 'a-completely-different-key-value'
      expect(() => decryptSecret(cipher)).toThrow()
    } finally {
      if (original === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY
      else process.env.CREDENTIALS_ENCRYPTION_KEY = original
    }
  })

  it('reports whether the encryption key is configured', () => {
    expect(isEncryptionConfigured()).toBe(true)
  })
})
