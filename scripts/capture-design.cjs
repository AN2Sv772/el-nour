// Capture the El Nour design screenshots used by the visual review.
//
//   node scripts/capture-design.cjs
//
// The session is minted exactly like the e2e suite does (the same admin
// cookie), so the screenshots show the REAL data — never a mock. Each shot
// waits for the network to settle before the capture, because a screenshot
// taken while the metrics are still loading is a screenshot of a lie.

const { chromium } = require('playwright')
const { execFileSync } = require('node:child_process')
const { readFileSync, mkdirSync } = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'replica', 'design', 'elnour')
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000'
const LANGUAGE_KEY = 'elnour.language'

const TARGETS = [
  { name: 'dashboard-desktop', url: '/dashboard', width: 1440, height: 900 },
  { name: 'dashboard-en-ltr', url: '/dashboard', width: 1440, height: 900, lang: 'en' },
  { name: 'dashboard-mobile', url: '/dashboard', width: 390, height: 844 },
  { name: 'orders-desktop', url: '/orders', width: 1440, height: 900 },
  { name: 'orders-mobile', url: '/orders', width: 390, height: 844 },
  { name: 'products-desktop', url: '/products', width: 1440, height: 900 },
  { name: 'products-mobile', url: '/products', width: 390, height: 844 },
  { name: 'overview-desktop', url: '/overview', width: 1440, height: 900 },
  { name: 'overview-mobile', url: '/overview', width: 390, height: 844 },
]

function mintSession() {
  const script = path.join(ROOT, 'scripts', 'mint-admin-session.cjs')
  execFileSync('node', [script], { stdio: 'ignore' })
  return JSON.parse(readFileSync('/tmp/cookie-pair.json', 'utf8'))
}

;(async () => {
  mkdirSync(OUT, { recursive: true })
  const cookie = mintSession()

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addCookies([
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

  for (const target of TARGETS) {
    const page = await context.newPage()
    await page.setViewportSize({ width: target.width, height: target.height })
    // Every page gets its language explicitly: the context persists storage,
    // so without this the language of one page would leak into the next.
    await page.addInitScript(
      ([key, lang]) => window.localStorage.setItem(key, lang),
      [LANGUAGE_KEY, target.lang ?? 'ar']
    )
    try {
      await page.goto(BASE + target.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
      await page.locator('#main-content').waitFor({ state: 'visible', timeout: 20000 })
      // The Next.js dev badge is not part of the product.
      await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' }).catch(() => {})
      await page.waitForTimeout(2500)
      await page.screenshot({ path: path.join(OUT, `${target.name}.png`), timeout: 60000 })
      console.log(`OK   ${target.name}`)
    } catch (error) {
      console.log(`FAIL ${target.name}: ${String(error.message).split('\n')[0]}`)
    } finally {
      await page.close()
    }
  }

  await browser.close()
  console.log('DONE')
})()
