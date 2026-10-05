// 仕様 07「最低限のE2E」：初期設定→装備購入→出発→レンタル→帰宅精算→分析→記録訂正→バックアップ→復元
// 金額は受入 A01・A03（docs/spec/fixtures/calculation-cases.json）に合わせる
import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'

async function goto(page: Page, tab: 'home' | 'records' | 'analytics' | 'plan' | 'settings') {
  await page.goto(`#${tab}`)
}

async function settingsSection(page: Page, name: string) {
  await goto(page, 'settings')
  await page.getByRole('tab', { name }).click()
}

test('初期設定から復元まで、1本の流れで数字が合う', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.clock.install({ time: new Date('2026-10-04T17:50:00+09:00') })

  // 1. 初期設定：目標の時給
  await goto(page, 'settings')
  await page.getByLabel('目標の営業純時給').fill('1500')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByRole('status').filter({ hasText: '保存しました' })).toBeVisible()

  // 2. 装備購入：初級プランの1品目を30,000円で「購入した」
  await settingsSection(page, '装備と投資')
  await page.getByLabel('価格（税込・1個）').first().fill('30000')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await page.getByRole('button', { name: '🧾 購入した' }).first().click()
  await page.getByRole('button', { name: '登録する' }).click()
  await expect(page.locator('section', { hasText: '投資の回収' })).toContainText('30,000円')

  // 3. 出発 → レンタル開始（18:00）→ 3時間後に帰宅して精算
  await page.clock.fastForward('10:00')
  await goto(page, 'home')
  await page.getByRole('button', { name: '🏠 自宅を出発' }).click()
  await page.getByRole('button', { name: '🚲 レンタル開始' }).click()
  await expect(page.getByRole('heading', { name: /稼働中/ })).toBeVisible()
  await page.clock.fastForward('03:00:00')
  await page.getByRole('button', { name: '🏁 帰宅して精算' }).click()

  // 4. 精算：売上 6,600 + 180 + 400 = 7,180円、その他経費 200円（レンタルは見積 1,760円）
  await page.getByLabel('基本報酬（配送料の合計）').fill('6600')
  await page.getByLabel('チップ').fill('180')
  await page.getByLabel('確定したクエスト・ボーナス').fill('400')
  await page.getByLabel('完了件数').fill('10')
  await page.getByRole('button', { name: '＋ 経費を追加' }).click()
  await page.getByLabel('金額').fill('200')
  await page.getByRole('button', { name: '✅ 確定して保存' }).click()
  await expect(page.locator('.list-item').first()).toContainText('5,220円')

  // 5. 分析（A01）：営業純利益 5,220円・時給 1,740円/時。回収（A03）：残り 24,780円
  await goto(page, 'analytics')
  const kpi = page.locator('section', { has: page.locator('#kpi-title') })
  await expect(kpi).toContainText('5,220円')
  await expect(kpi).toContainText('1,740円/時')
  await expect(kpi).toContainText('目標以上')
  await expect(page.locator('section', { hasText: '投資の回収' })).toContainText('24,780円')

  // 6. 記録訂正：チップを 180 → 480 円に直すと、利益は 5,520円
  await goto(page, 'records')
  await page.locator('.list-item').first().click()
  await page.getByLabel('チップ').fill('480')
  await page.getByRole('button', { name: '✅ 確定して保存' }).click()
  await expect(page.locator('.list-item').first()).toContainText('5,520円')

  // 7. バックアップを書き出す
  await settingsSection(page, 'データ')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '⬇️ バックアップを書き出す' }).click()
  const backupPath = await (await downloading).path()
  const backup = JSON.parse(await readFile(backupPath, 'utf8'))
  expect(backup.datasets.sessions).toHaveLength(1)

  // 8. すべて削除 → 記録が空になる
  await page.getByRole('button', { name: '🗑️ すべて削除する' }).click()
  await goto(page, 'records')
  await expect(page.locator('.list-item')).toHaveCount(0)

  // 9. 復元 → 記録・ID・計算結果が元どおり
  await settingsSection(page, 'データ')
  await page.getByLabel('バックアップのファイル（.json）').setInputFiles(backupPath)
  await expect(page.getByText('稼働の記録：1件')).toBeVisible()
  await page.getByRole('button', { name: '♻️ この内容で置き換える' }).click()
  await expect(page.getByText('✅ 復元しました')).toBeVisible()
  await goto(page, 'analytics')
  await expect(kpi).toContainText('5,520円')
  await expect(page.locator('section', { hasText: '投資の回収' })).toContainText('24,480円')
  await goto(page, 'records')
  await page.locator('.list-item').first().click()
  await expect(page.getByLabel('チップ')).toHaveValue('480')

  expect(errors).toEqual([])
})
