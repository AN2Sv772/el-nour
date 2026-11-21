import { test, expect, BASE_URL } from './helpers'

/**
 * The language switch must be a REAL switch.
 *
 * Translating the labels is the easy half. The hard half is the direction:
 * in Arabic the shell is RTL (the sidebar on the right), in English it is
 * LTR (the sidebar on the left). A hard-coded `dir="rtl"` anywhere in the
 * shell silently pins the layout to one side while the labels claim the
 * other — this spec is the regression guard for exactly that.
 */

const LANGUAGE_KEY = 'elnour.language'

test.beforeEach(async ({ authedPage: page }) => {
  // Start from a known state: a fresh context has no stored language, so the
  // default is Arabic. The guard matters on the reload inside the first
  // test — it must NOT overwrite the English the app persisted.
  await page.addInitScript((key) => {
    if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, 'ar')
  }, LANGUAGE_KEY)
})

test('the language switch mirrors the shell and survives a reload', async ({ authedPage: page }) => {
  await page.goto(`${BASE_URL}/dashboard`)

  const html = page.locator('html')
  await expect(html).toHaveAttribute('dir', 'rtl')
  await expect(html).toHaveAttribute('lang', 'ar')

  const sidebar = page.locator('aside').first()
  await expect(sidebar).toBeVisible()

  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()

  // RTL — the sidebar hugs the RIGHT edge.
  const rtlBox = await sidebar.boundingBox()
  expect(rtlBox).not.toBeNull()
  expect(Math.abs(rtlBox!.x + rtlBox!.width - viewport!.width)).toBeLessThan(4)

  // Switch to English.
  await page.getByRole('button', { name: 'اللغة' }).click()
  await page.getByRole('menuitem', { name: 'English' }).click()

  await expect(html).toHaveAttribute('dir', 'ltr')
  await expect(html).toHaveAttribute('lang', 'en')

  // The chrome is translated…
  await expect(sidebar.getByRole('link', { name: 'Orders' })).toBeVisible()

  // …and the layout is mirrored: the sidebar moves to the LEFT edge.
  const ltrBox = await sidebar.boundingBox()
  expect(ltrBox).not.toBeNull()
  expect(Math.abs(ltrBox!.x)).toBeLessThan(4)

  // The choice is persisted, so the next visit starts in English.
  await page.reload()
  await expect(html).toHaveAttribute('dir', 'ltr')
  await expect(sidebar.getByRole('link', { name: 'Orders' })).toBeVisible()
})

test('the English layout does not overflow horizontally', async ({ authedPage: page }) => {
  await page.goto(`${BASE_URL}/dashboard`)
  await page.getByRole('button', { name: 'اللغة' }).click()
  await page.getByRole('menuitem', { name: 'English' }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')

  const overflow = await page.evaluate(() => {
    const doc = document.documentElement
    return doc.scrollWidth - doc.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(2)
})

test('the mobile drawer opens and shows the navigation', async ({ authedPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${BASE_URL}/dashboard`)

  await page.getByRole('button', { name: 'فتح القائمة' }).click()

  // The drawer must actually render its links — a drawer that opens empty is
  // a navigation dead end on the phone.
  const drawerLink = page.getByRole('link', { name: 'الطلبات' }).first()
  await expect(drawerLink).toBeVisible()
})
