// HELLO CYCLING の上限（2,500円）：上限までの残り、上限の後は 0円、乗る長さごとの1時間あたりのレンタル代
import { expect, test } from '@playwright/test'

test('レンタル中は上限までの残りと、上限の後は追加 0円になる時刻が出る。長く乗るほど1時間あたりが下がる表も見られる', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T14:00:00+09:00') })
  await page.goto('#home')
  await page.getByRole('button', { name: '自宅を出発' }).click()
  await page.getByRole('button', { name: 'レンタル開始' }).click()
  await page.getByText('料金の上限・乗る長さごとの料金', { exact: true }).click()
  await expect(page.getByText(/上限 2,500円 まで あと/)).toBeVisible()
  // 14:00 に借りると、18:00（240分1秒）に上限に達し、翌2:00（12時間）までは増えない
  await expect(page.getByText(/（18:00）。そこから 02:00 までは追加 0円/)).toBeVisible()

  // 乗る長さとレンタル代：5時間で2,500円（500円/時）、8時間が一番安い（313円/時）
  await page.getByText('📊 乗る長さとレンタル代（1時間あたり）').click()
  const table = page.getByRole('region', { name: '乗る長さとレンタル代' })
  await expect(table.getByRole('row', { name: /^5時間/ })).toContainText('2,500円')
  await expect(table.getByRole('row', { name: /^5時間/ })).toContainText('500円/時')
  await expect(table.locator('tr.picked')).toContainText('8時間')

  // 18:30 には上限に到達している
  await page.clock.setFixedTime(new Date('2026-10-05T18:30:00+09:00'))
  await page.reload()
  await page.getByText('料金の上限・乗る長さごとの料金', { exact: true }).click()
  await expect(page.getByText(/上限 2,500円 に到達。02:00 まで追加 0円/)).toBeVisible()

  // 終了までの見通しにも出る。上限で乗れる時間（翌2:00）を過ぎる終了予定なら、その先は見積の対象外と伝える
  await page.getByText('📋 判断のたすけ').click()
  const end = page.getByLabel('終了予定（配達をやめる時刻）', { exact: true })
  await end.fill('23:00')
  await expect(page.getByText('レンタルは上限 2,500円 に達しています。02:00 までは追加のレンタル代がかかりません')).toBeVisible()
  await end.fill('03:00')
  await expect(page.getByText(/02:00 までは追加のレンタル代がかかりません。ただし 02:00 を過ぎるとレンタル代は見積の対象外です/)).toBeVisible()
})
