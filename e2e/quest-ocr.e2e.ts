// クエストの画面のスクショを、端末の中の文字認識で読み取り、期間と段階を入力欄に入れる（画像は合成）
import { expect, test } from '@playwright/test'

test('クエストの進捗の画面のスクショから、期間と段階を読み取って入力欄に入れる（外へは送らない）', async ({ page }) => {
  test.setTimeout(90_000)
  await page.clock.install({ time: new Date('2026-10-07T00:05:00+09:00') })
  // 外部のサイトへの通信がないことを確かめる
  const external: string[] = []
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost')) external.push(r.url())
  })
  await page.goto('#home')
  await page.getByRole('button', { name: 'クエストを追加' }).click()
  await page.getByLabel('📷 スクショから読み取る').setInputFiles('e2e/fixtures/quest-weekend.png')
  await expect(page.getByRole('status').filter({ hasText: '読み取りました' })).toContainText(
    '開始 10/9(金) 04:00・終了 10/12(月) 04:00・段階2つ（最後は50件）',
    { timeout: 60_000 },
  )
  await expect(page.getByLabel('名前', { exact: true })).toHaveValue('日跨ぎクエスト')
  await expect(page.getByLabel('開始', { exact: true })).toHaveValue('2026-10-09T04:00')
  await expect(page.getByLabel('終了', { exact: true })).toHaveValue('2026-10-12T04:00')
  await expect(page.getByLabel('報酬の書き方', { exact: true })).toHaveValue('incremental')
  await expect(page.getByLabel('第1段階の件数', { exact: true })).toHaveValue('40')
  await expect(page.getByLabel('第2段階の件数', { exact: true })).toHaveValue('50')
  await expect(page.getByLabel('報酬', { exact: true }).nth(0)).toHaveValue('3770')
  await expect(page.getByLabel('報酬', { exact: true }).nth(1)).toHaveValue('1170')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.locator('.subcard', { hasText: '日跨ぎクエスト' })).toContainText('0件／あと40件で+3,770円')
  expect(external).toEqual([])

  // 保存済みのクエストを開いて読み取り直しても、付けた名前は変えない
  await page.locator('.subcard', { hasText: '日跨ぎクエスト' }).getByRole('button', { name: '日跨ぎクエストを編集・件数の調整' }).click()
  await page.getByLabel('名前', { exact: true }).fill('週末50回ボーナス')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await page.locator('.subcard', { hasText: '週末50回ボーナス' }).getByRole('button', { name: '週末50回ボーナスを編集・件数の調整' }).click()
  await page.getByLabel('📷 スクショから読み取る').setInputFiles('e2e/fixtures/quest-weekend.png')
  await expect(page.getByRole('status').filter({ hasText: '読み取りました' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByLabel('名前', { exact: true })).toHaveValue('週末50回ボーナス')
})
