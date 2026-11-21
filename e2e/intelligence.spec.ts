import { test, expect, BASE_URL } from './helpers'

/**
 * F12–F16 — the intelligence screens (risk, anomalies, forecast, simulator,
 * briefing). Every assertion is about honesty: a number, or a stated reason
 * for not having one.
 */

test.describe('F12 — COD risk review', () => {
  test('F12-H1: the readiness banner states whether delivery history exists', async ({ authedPage: page }) => {
    await page.goto(`${BASE_URL}/risk`)
    await expect(page.getByRole('heading', { name: 'مخاطر التحصيل عند الاستلام' })).toBeVisible()
    await expect(page.locator('body')).toContainText('جاهزية البيانات')
    await expect(page.locator('body')).toContainText('طلب مفتوح تم تقييمه')
  })

  test('F12-N1: the page offers no rejection action', async ({ authedPage: page }) => {
    await page.goto(`${BASE_URL}/risk`)
    const body = page.locator('body')
    await expect(body).not.toContainText(/رفض الطلب|رفض تلقائي|حظر/)
  })
})

test.describe('F13 — anomalies', () => {
  test('F13-H1: each anomaly shows the baseline next to the actual value', async ({ authedPage: page }) => {
    await page.goto(`${BASE_URL}/anomalies`)
    await expect(page.getByRole('heading', { name: 'شذوذ الأعمال' })).toBeVisible()
    await expect(page.locator('body')).toContainText('المعتاد')
    await expect(page.locator('body')).toContainText('الفعلي')
    await expect(page.locator('body')).toContainText('احتمالات (ليست تشخيصًا)')
  })
})

test.describe('F14 — demand forecast', () => {
  test('F14-H1: the forecast publishes its method, its error and its limits', async ({ authedPage: page }) => {
    await page.goto(`${BASE_URL}/forecast`)
    await expect(page.getByRole('heading', { name: 'تنبؤ الطلبات' })).toBeVisible()
    await expect(page.locator('body')).toContainText('خط أساس إحصائي — ليس نموذج تعلّم آلي')
    await expect(page.locator('body')).toContainText('MAPE')
    await expect(page.locator('body')).toContainText('حدود التنبؤ')
  })

  test('F14-H2: the horizon changes the forecast length', async ({ authedPage: page }) => {
    await page.goto(`${BASE_URL}/forecast`)
    await page.getByRole('button', { name: '30 يوم' }).click()
    await expect(page.locator('body')).toContainText('خلال 30 يوم')
  })
})

test.describe('F15 — profit simulator', () => {
  test('F15-H1: the levers are exposed and the baseline is shown', async ({ authedPage: page }) => {
    await page.goto(`${BASE_URL}/simulator`)
    await expect(page.getByRole('heading', { name: 'محاكي الأرباح' })).toBeVisible()
    await expect(page.getByText('سعر البيع', { exact: true })).toBeVisible()
    await expect(page.locator('body')).toContainText('قبل / بعد')
  })

  test('F15-E1: with the costs missing the profit stays withheld', async ({ authedPage: page }) => {
    await page.goto(`${BASE_URL}/simulator`)
    await expect(page.locator('body')).toContainText('صافي الربح ما زال محجوبًا')
  })

  test('F15-N1: a no-op simulation changes nothing', async ({ authedPage: page }) => {
    await page.goto(`${BASE_URL}/simulator`)
    await expect(page.locator('body')).toContainText('فرق المبيعات')
    const delta = await page.locator('body').innerText()
    expect(delta).toMatch(/فرق المبيعات\s*0\s*ج\.م/)
  })
})

test.describe('F16 — daily briefing', () => {
  test('F16-H1: the briefing states the date and the headline', async ({ authedPage: page }) => {
    await page.goto(`${BASE_URL}/briefing`)
    await expect(page.getByRole('heading', { name: 'إحاطة البيزنس اليومية' })).toBeVisible()
    await expect(page.locator('body')).toContainText('صباح الخير')
    await expect(page.locator('body')).toContainText('مهام مقترحة')
  })

  test('F16-E2: the blind spots are listed', async ({ authedPage: page }) => {
    await page.goto(`${BASE_URL}/briefing`)
    await expect(page.locator('body')).toContainText('ما لا تستطيع الإحاطة قوله بعد')
  })
})
