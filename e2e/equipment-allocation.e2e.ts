import { expect, test } from '@playwright/test'

for (const legacy of [false, true]) {
test(`購入後の配賦期間を修正できる（旧版で保存済み：${legacy}）`, async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-12T12:00:00+09:00') })
  await page.goto('#settings')
  await page.getByRole('tab', { name: '装備と投資' }).click()
  const item = page.locator('details.fold').first()
  await item.locator('summary').click()
  await item.getByLabel('価格（税込・1個）', { exact: true }).fill('4000')
  await item.getByLabel('配賦期間', { exact: true }).fill('12')
  await item.getByRole('button', { name: '🧾 購入した' }).click()
  await item.getByRole('button', { name: '登録する' }).click()
  await expect(page.getByRole('status')).toContainText('購入として登録しました')
  await page.goto('#analytics')
  const breakdown = page.getByRole('table', { name: '売上から投資配賦後の利益までの内訳' })
  await expect(breakdown).toContainText('−333円')
  if (legacy) {
    // 旧版でプランだけ1か月に保存され、資産が12か月のままの状態を再現。
    await page.evaluate(async () => {
      const databases = await indexedDB.databases()
      const name = databases.find((d) => d.name && !d.name.includes('demo'))!.name!
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('plans', 'readwrite')
          const store = tx.objectStore('plans')
          const rows = store.getAll()
          rows.onsuccess = () => {
            for (const plan of rows.result) {
              for (const item of plan.items) if (item.assetId) item.lifetimeMonths = 1
              store.put(plan)
            }
          }
          tx.oncomplete = () => { db.close(); resolve() }
          tx.onerror = () => { db.close(); reject(tx.error) }
        }
      })
    })
    await page.reload()
  }
  await page.goto('#settings')
  await page.getByRole('tab', { name: '装備と投資' }).click()
  await item.locator('summary').click()
  if (legacy) await expect(item.getByLabel('配賦期間', { exact: true })).toHaveValue('1')
  else await item.getByLabel('配賦期間', { exact: true }).fill('1')
  for (const width of [320, 390, 844, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.getByRole('button', { name: '💾 保存', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '配賦期間も分析に反映しました' })).toBeVisible()
  await page.reload()
  await page.getByRole('tab', { name: '装備と投資' }).click()
  await item.locator('summary').click()
  await expect(item.getByLabel('配賦期間', { exact: true })).toHaveValue('1')
  await page.goto('#analytics')
  await expect(breakdown).toContainText('−4,000円')
})

}
