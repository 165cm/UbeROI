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

  // 別のサービスの夜ピーク：日跨ぎ（Uber）の配達には数えないので、作戦に入れない
  await page.getByRole('button', { name: 'クエストを追加' }).click()
  await page.getByLabel('名前', { exact: true }).fill('出前館の夜')
  await page.getByLabel('対象のサービス', { exact: true }).selectOption({ index: 1 })
  await page.getByLabel('開始', { exact: true }).fill('2026-10-09T17:00')
  await page.getByLabel('終了', { exact: true }).fill('2026-10-09T20:00')
  await page.getByLabel('くり返し', { exact: true }).selectOption('daily')
  await fillTiers(page, [[5, 1000]])
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.locator('.subcard', { hasText: '出前館の夜' })).toBeVisible()

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

test('働ける時間（副業：平日は夜だけ）の中で、作戦の時間を帯に置き、入らない時間を知らせる。目標を変えると帯も変わる', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-07T08:00:00+09:00') })
  // 設定 → 基本 → 🕒 働ける時間：プリセットを選んで保存
  await page.goto('#settings')
  await page.getByRole('button', { name: '働ける時間を編集' }).click()
  await page.getByRole('button', { name: '🌙 副業：平日は夜だけ' }).click()
  await expect(page.getByLabel('金曜 1つ目の開始', { exact: true })).toHaveValue('19:00')
  await expect(page.getByLabel('土曜 1つ目の終了', { exact: true })).toHaveValue('22:00')
  await page.getByRole('button', { name: '💾 保存' }).last().click()
  await expect(page.getByText('働ける時間を保存しました（1週間 44時間）')).toBeVisible()

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
  // 金曜の昼ピークは働ける時間の外なので数えない。ピークは土日の10件、ほか40件を 14・13・13
  const card = page.getByRole('region', { name: '🧭 クエスト作戦（日跨ぎ）' })
  await expect(card).toContainText('働ける時間の外のピーク 1回は数えていません')
  const rows = card.getByRole('region', { name: '本命の日ごとの件数' }).getByRole('row')
  await expect(rows.nth(1).locator('th, td')).toHaveText(['金 10/9', '0件', '+14件', '14件', '7h'])

  // 帯：金曜は 19〜23時の4時間だけ働ける → 7時間のうち3時間入らない
  const plan = page.getByRole('group', { name: 'クエスト作戦の時間' })
  await expect(plan).toContainText('🧭 日跨ぎ 本命50件：この週')
  await expect(plan).toContainText('⚠️ 働ける時間に 3h 入らない')
  const days = plan.getByRole('list', { name: '作戦の日ごとの時間' }).getByRole('listitem')
  await expect(days.nth(0)).toContainText('金 10/9')
  await expect(days.nth(0)).toContainText('19:00〜23:00')
  await expect(days.nth(0)).toContainText('⚠️3h入らない')
  await expect(days.nth(1)).toContainText('11:30〜14:00')
  await expect(page.locator('.wb-off').first()).toBeAttached()

  // 目標を「最低 40件」にすると、帯の作戦も変わる（ほか30件を 10・10・10 → 金曜は5時間、1時間入らない）
  await card.getByRole('tab', { name: '最低 40件' }).click()
  await expect(plan).toContainText('🧭 日跨ぎ 最低40件')
  await expect(days.nth(0)).toContainText('⚠️1h入らない')

  // ＋で作戦の時間をまとめて候補枠に入れる
  await plan.getByRole('button', { name: '作戦の時間を候補枠に入れる' }).click()
  await expect(page.getByText(/つの候補枠を入れました/)).toBeVisible()
  await expect(page.getByRole('button', { name: /10\/9\(金\) 19:00〜23:00/ })).toBeVisible()
})

