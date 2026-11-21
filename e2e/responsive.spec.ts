import { test, expect, BASE_URL } from './helpers'

/**
 * The responsive contract: the screens must work at the widths an Egyptian
 * store owner actually uses — a cheap Android phone and a laptop.
 */

const WIDTHS = [360, 390, 430, 768, 1024, 1440]

const SCREENS = ['/overview', '/briefing', '/risk', '/anomalies', '/forecast', '/simulator', '/setup/costs']

for (const width of WIDTHS) {
  test(`the screens fit at ${width}px`, async ({ authedPage: page }) => {
    await page.setViewportSize({ width, height: 900 })
    for (const screen of SCREENS) {
      await page.goto(`${BASE_URL}${screen}`)
      await expect(page.locator('h1')).toBeVisible()
      // No horizontal overflow: the page must scroll down, not sideways.
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement
        return doc.scrollWidth - doc.clientWidth
      })
      expect(overflow, `${screen} overflows horizontally at ${width}px`).toBeLessThanOrEqual(2)
    }
  })
}
