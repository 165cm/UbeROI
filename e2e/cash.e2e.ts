// ホームの「💴 お釣り」：出されそうな額を押すとお釣りが出る。一覧にない額は入力して出す
import { expect, test } from '@playwright/test'

test('支払い金額を入れると、出されそうな額ごとのお釣りが並び、受け取った額でお釣りが出る', async ({ page }) => {
  await page.goto('#home')
  await page.getByText('💴 お釣り').click()
  await page.getByLabel('支払い金額', { exact: true }).fill('4260')
  const rows = page.locator('.cash-row')
  await expect(rows).toHaveCount(6)
  await expect(rows.nth(4)).toContainText('5,260円')
  await expect(rows.nth(4)).toContainText('1,000円')

  await rows.nth(4).click()
  await expect(page.getByRole('status').filter({ hasText: 'お釣り' })).toContainText('お釣り 1,000円')

  await page.getByLabel('受け取った額', { exact: true }).fill('5300')
  await expect(page.getByRole('status').filter({ hasText: 'お釣り' })).toContainText('お釣り 1,040円')
  await expect(page.getByRole('status').filter({ hasText: 'お釣り' })).toContainText('1千円×1・10円×4')

  await page.getByLabel('受け取った額', { exact: true }).fill('4000')
  await expect(page.getByRole('status').filter({ hasText: '足りません' })).toContainText('あと 260円 足りません')
})
