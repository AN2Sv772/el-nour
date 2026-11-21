import { test as base, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Shared e2e helpers.
 *
 * The suite runs against the REAL application and the REAL database — no
 * seeded or mocked business data. The only thing that is generated is the
 * admin session, because the screens live behind the auth wall.
 *
 * Every spec fails on a console error and on any 5xx response, as the
 * replica-test method requires.
 */

export const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000'

/** Mint a fresh admin session and return the cookie name/value pair. */
export function mintSession(): { name: string; value: string } {
  const script = path.resolve(process.cwd(), 'scripts/mint-admin-session.cjs')
  if (!existsSync(script)) {
    throw new Error('scripts/mint-admin-session.cjs is missing — cannot authenticate the e2e run')
  }
  execFileSync('node', [script], { stdio: 'ignore' })
  const pair = JSON.parse(readFileSync('/tmp/cookie-pair.json', 'utf8'))
  return pair
}

export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    const cookie = mintSession()
    await page.context().addCookies([
      {
        name: cookie.name,
        value: cookie.value,
        domain: 'localhost',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ])

    const consoleErrors: string[] = []
    const serverErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('response', (response) => {
      if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`)
    })

    await use(page)

    // The guards run after the test body.
    expect(serverErrors, `5xx responses:\n${serverErrors.join('\n')}`).toEqual([])
    expect(
      consoleErrors.filter(e => !/favicon|Download the React DevTools/i.test(e)),
      `console errors:\n${consoleErrors.join('\n')}`
    ).toEqual([])
  },
})

export { expect }
