// くり返すクエスト：一度登録すると、次の回からは登録し直さなくても今の回の期間で数える
import { expect, test } from '@playwright/test'

test('毎週の平日クエストは、翌週になっても今の回（月4:00〜金4:00）で出て、件数は回ごとに数える', async ({ page }) => {
  // 月曜の昼
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+09:00') })
  await page.goto('#home')
  await page.getByRole('button', { name: 'クエストを追加' }).click()
  await page.getByRole('button', { name: '🔁 毎週の平日（月4:00〜金4:00）' }).click()
  await expect(page.getByLabel('くり返し', { exact: true })).toHaveValue('weekly')
  await page.getByLabel('名前', { exact: true }).fill('平日クエスト')
  await page.getByLabel('第1段階の件数', { exact: true }).fill('10')
  await page.getByLabel('報酬', { exact: true }).fill('1000')
  await page.getByLabel('この回の件数の調整（±）', { exact: true }).fill('2')
  await page.getByRole('button', { name: '💾 保存' }).click()
  const card = page.locator('.subcard', { hasText: '平日クエスト' })
  await expect(card).toContainText('🔁 毎週')
  await expect(card).toContainText(/10\/5.*〜10\/9/)
  await expect(card).toContainText('2件／あと8件で+1,000円')

  // 翌週の火曜：登録し直さなくても、10/12〜10/16 の回で 0件から数える
  await page.clock.setFixedTime(new Date('2026-10-13T12:00:00+09:00'))
  await page.reload()
  await expect(card).toContainText(/10\/12.*〜10\/16/)
  await expect(card).toContainText('0件／あと10件で+1,000円')
  // この回だけの調整
  await card.getByRole('button', { name: '平日クエストを編集・件数の調整' }).click()
  await expect(page.getByLabel('この回の件数の調整（±）', { exact: true })).toHaveValue('0')
  await page.getByLabel('この回の件数の調整（±）', { exact: true }).fill('5')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(card).toContainText('5件／あと5件で+1,000円')

  // くり返しをやめる時は、調整は最初の回（くり返さないクエストの調整）を読み書きする
  await card.getByRole('button', { name: '平日クエストを編集・件数の調整' }).click()
  await page.getByLabel('くり返し', { exact: true }).selectOption('none')
  await expect(page.getByLabel('件数の調整（±）', { exact: true })).toHaveValue('2')
})

test('毎日くり返すクエストは、期間が1日より長いと保存できない', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+09:00') })
  await page.goto('#home')
  await page.getByRole('button', { name: 'クエストを追加' }).click()
  await page.getByRole('button', { name: '選択制（今の期間）' }).click()
  await page.getByLabel('くり返し', { exact: true }).selectOption('daily')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '次の回と重ならない長さ（1日まで）' })).toBeVisible()
})
