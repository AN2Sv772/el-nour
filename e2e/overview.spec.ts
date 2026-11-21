import { test, expect, BASE_URL } from './helpers'

/**
 * F05 — the cockpit (/overview) and the dashboard must agree.
 *
 * The rule under test: one metric engine, one truth. If the dashboard and
 * the cockpit ever disagree, the product is lying to the owner twice.
 */

test.describe('F05 — owner checks today’s business', () => {
  test('F05-H1: /overview shows the six headline numbers with a status', async ({ authedPage: page }) => {
    await page.goto(`${BASE_URL}/overview`)
    await expect(page.getByRole('heading', { name: 'نظرة عامة على النشاط' })).toBeVisible()

    // The six cards.
    for (const label of [
      'صافي الربح',
      'ROAS المُسلَّم',
      'الربح لكل طلب',
      'تعرّض الإرجاع (RTO)',
      'النقد الناقص',
      'معدل التسليم',
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
  })

  test('F05-E1: the profit is withheld with a reason, never a bare number', async ({ authedPage: page }) => {
    await page.goto(`${BASE_URL}/overview`)
    const body = page.locator('body')
    await expect(body).toContainText('الربح لا يُعرض حتى تكون كل المدخلات مسجّلة')
  })

  test('F05-H2: changing the window re-reads the same window engine', async ({ authedPage: page }) => {
    await page.goto(`${BASE_URL}/overview`)
    await expect(page.locator('body')).toContainText('آخر 7 أيام')
    await page.getByRole('button', { name: 'آخر 30 يومًا' }).click()
    await expect(page.locator('body')).toContainText('آخر 30 يومًا')
    await expect(page.locator('body')).not.toContainText('جارٍ الحساب')
  })

  test('F05-H3: the dashboard and the cockpit report the same revenue for the same window', async ({
    authedPage: page,
  }) => {
    // The dashboard opens on the last 30 days; the cockpit on the last 7.
    // The comparison is only meaningful when both read the SAME window, so
    // the dashboard's number is captured first and the cockpit is then moved
    // to that window and must land on exactly the same value.
    await page.goto(`${BASE_URL}/dashboard`)
    const dashboardRevenue = page.locator('[data-metric-key="revenue"] [data-metric-value]')
    await expect(dashboardRevenue).toContainText(/\d/)
    const expected = (await dashboardRevenue.innerText()).trim()

    await page.goto(`${BASE_URL}/overview`)
    await page.getByRole('button', { name: 'آخر 30 يومًا' }).click()
    await expect(page.getByRole('heading', { name: /الربح — آخر 30 يومًا/ })).toBeVisible()

    // The overview shows the sales leg under the profit breakdown.
    const overviewRevenue = page.locator('[data-metric-key="sales"] [data-metric-value]')
    // Retries until the 30-day read lands — the 7-day value must not pass.
    await expect(overviewRevenue).toHaveText(expected)

    // And the number is a real one, not the withheld dash.
    expect(expected).toMatch(/\d/)
    expect(expected).toContain('ج.م')
  })

  test('F05-N1: an unauthenticated visitor is sent to the login page', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${BASE_URL}/overview`)
    await expect(page).toHaveURL(/\/login/)
    await context.close()
  })
})
