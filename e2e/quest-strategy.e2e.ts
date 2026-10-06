// 計画：🧭 クエスト作戦（日跨ぎ＋毎日の昼ピーク）
import { expect, test, type Page } from '@playwright/test'

async function fillTiers(page: Page, tiers: [number, number][]) {
  for (let i = 0; i < tiers.length; i++) {
    if (i > 0) await page.getByRole('button', { name: '＋ 段階を追加' }).click()
    await page.getByLabel(`第${i + 1}段階の件数`, { exact: true }).fill(String(tiers[i]![0]))
    await page.getByLabel('報酬', { exact: true }).nth(i).fill(String(tiers[i]![1]))
  }
}

test('日跨ぎと毎日のピークをまとめて、本命・最低の目標ごとに日ごとの件数・時間・報酬を出す', async ({ page }) => {
  // 水曜の朝。日跨ぎは 金4:00〜月4:00
  await page.clock.install({ time: new Date('2026-10-07T08:00:00+09:00') })
  await page.goto('#home')
  await page.getByRole('button', { name: 'クエストを追加' }).click()
  await page.getByLabel('名前', { exact: true }).fill('日跨ぎ')
  await page.getByLabel('開始', { exact: true }).fill('2026-10-09T04:00')
  await page.getByLabel('終了', { exact: true }).fill('2026-10-12T04:00')
  await fillTiers(page, [
    [40, 3770],
    [50, 1170],
  ])
  await page.getByRole('button', { name: '💾 保存' }).click()
  // 昼ピーク：金曜 11:30〜14:00 から毎日。1〜5件で 100・150・150・200・300円
  await page.getByRole('button', { name: 'クエストを追加' }).click()
  await page.getByLabel('名前', { exact: true }).fill('昼ピーク')
  await page.getByLabel('開始', { exact: true }).fill('2026-10-09T11:30')
  await page.getByLabel('終了', { exact: true }).fill('2026-10-09T14:00')
  await page.getByLabel('くり返し', { exact: true }).selectOption('daily')
  await fillTiers(page, [
    [1, 100],
    [2, 150],
    [3, 150],
    [4, 200],
    [5, 300],
  ])
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.locator('.subcard', { hasText: '昼ピーク' })).toBeVisible()

  await page.goto('#plan')
  const card = page.getByRole('region', { name: '🧭 クエスト作戦（日跨ぎ）' })
  await expect(card.getByRole('tab', { name: '本命 50件' })).toHaveAttribute('aria-selected', 'true')
  // 50件：昼ピーク 5件×3日＝15件、ほかの35件を 12・12・11。時間＝ピーク2.5h＋ほか÷2件/時（8.5＋8.5＋8）
  await expect(card.getByRole('definition')).toHaveText(['50件', '約25h', '7,640円（1件 +153円）', '42,640円'])
  const rows = card.getByRole('region', { name: '本命の日ごとの件数' }).getByRole('row')
  await expect(rows.nth(1).locator('th, td')).toHaveText(['金 10/9', '5件', '+12件', '17件', '8.5h'])
  await expect(rows.nth(3).locator('th, td')).toHaveText(['日 10/11', '5件', '+11件', '16件', '8h'])
  // 最低 40件：ほかは25件（9・8・8）、報酬は 3,770円＋900円×3
  await card.getByRole('tab', { name: '最低 40件' }).click()
  await expect(card.getByRole('definition').nth(2)).toHaveText('6,470円（1件 +162円）')
  await expect(card.getByRole('region', { name: '最低の日ごとの件数' }).getByRole('row').nth(1).locator('th, td')).toHaveText(['金 10/9', '5件', '+9件', '14件', '7h'])
})
