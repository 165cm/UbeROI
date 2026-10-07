import { expect, test } from '@playwright/test'

test('4つのメニューから未精算を再開し、明暗・縦横・拡大でも保存できる', async ({ page }, testInfo) => {
  await page.goto('#home')
  await expect(page.getByRole('navigation').getByRole('link')).toHaveText(['今日', '計画', '記録', '分析'])
  await page.getByRole('link', { name: '設定', exact: true }).click()
  await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '記録', exact: true }).click()
  await page.getByRole('button', { name: /過去の稼働をまとめて入力/ }).click()
  await page.getByLabel('出発（自宅を出た時刻）', { exact: true }).fill('2026-10-07T18:00')
  await page.getByLabel('帰宅', { exact: true }).fill('2026-10-07T21:00')
  await page.getByLabel('基本報酬（配送料の合計）', { exact: true }).fill('6600')
  await page.getByLabel('チップ', { exact: true }).fill('180')
  await page.getByLabel('確定ボーナス', { exact: true }).fill('400')
  await page.getByRole('button', { name: '📝 下書き保存', exact: true }).click()
  await page.getByRole('button', { name: '未精算・下書き（1）', exact: true }).click()
  await page.locator('.record-item').click()
  await expect(page.getByLabel('帰宅', { exact: true })).toBeHidden()
  await expect(page.locator('.settlement-summary')).toContainText('7,180円')
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    for (const [width, height] of [[320, 700], [390, 844], [844, 390], [1280, 800]]) {
      await page.setViewportSize({ width: width!, height: height! })
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
      await expect(page.getByRole('button', { name: '✅ 確定して保存', exact: true })).toBeInViewport()
      if (width === 390) await page.screenshot({ path: testInfo.outputPath(`settlement-${colorScheme}.png`), fullPage: true })
    }
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '✅ 確定して保存', exact: true }).click()
  await expect(page.getByText('未精算・下書きはありません。')).toBeVisible()
  await page.getByRole('button', { name: 'すべて', exact: true }).click()
  await expect(page.locator('.record-item')).toContainText('7,180円')
})

test('稼働中の主な操作は52px以上。昼下がりは休憩の比較が折りたたみの外で自動で開く', async ({ page }) => {
  // 昼下がり（注文が少なめの時間）
  await page.clock.install({ time: new Date('2026-10-07T14:00:00+09:00') })
  await page.goto('#home')
  const depart = page.getByRole('button', { name: '🏠 自宅を出発' })
  expect((await depart.boundingBox())!.height).toBeGreaterThanOrEqual(52)
  await depart.click()
  const start = page.getByRole('button', { name: '🚲 レンタル開始' })
  expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(52)
  await start.click()
  const back = page.getByRole('button', { name: '🅿️ 返却した' })
  await expect(back).toBeVisible()
  expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(52)
  // 料金の上限・乗る長さごとの料金は畳んだまま、休憩の比較は開いて見える
  await expect(page.locator('details.rental-details')).not.toHaveAttribute('open', '')
  await expect(page.getByText(/☕ 休憩するなら/)).toBeVisible()
  await expect(page.getByText(/☕ 休憩するなら/).locator('xpath=..')).toHaveAttribute('open', '')
})
