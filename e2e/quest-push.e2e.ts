// 稼働中の「🎯 あと何件？」：日跨ぎ・リーダーボードの次の目標まで、あと何件・何分、終了予定までに届くか
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('稼働中に ＋ で件数を数えると、次の段階・順位まであと何件・届くかが出て、読み直しても残る', async ({ page }) => {
  // 日曜 19時（日跨ぎは月曜 4時まで）
  await page.clock.install({ time: new Date('2026-10-11T19:00:00+09:00') })
  await page.goto('#home')
  await page.getByRole('button', { name: 'クエストを追加' }).click()
  await page.getByLabel('名前', { exact: true }).fill('日跨ぎ')
  await page.getByLabel('開始', { exact: true }).fill('2026-10-09T04:00')
  await page.getByLabel('終了', { exact: true }).fill('2026-10-12T04:00')
  await page.getByLabel('第1段階の件数', { exact: true }).fill('40')
  await page.getByLabel('報酬', { exact: true }).fill('3770')
  await page.getByRole('button', { name: '＋ 段階を追加' }).click()
  await page.getByLabel('第2段階の件数', { exact: true }).fill('50')
  await page.getByLabel('報酬', { exact: true }).nth(1).fill('1170')
  // これまでの配達（記録していない分）40件
  await page.getByLabel('件数の調整（±）', { exact: true }).fill('40')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.locator('.subcard', { hasText: '日跨ぎ' })).toBeVisible()
  // リーダーボード：自分は5位 42件、4位 44件、3位 55件
  await page.getByRole('button', { name: '日跨ぎのリーダーボードを入れる' }).click()
  const form = page.getByRole('form', { name: '日跨ぎのリーダーボード' })
  await form.getByLabel('自分の順位', { exact: true }).fill('5')
  await form.getByLabel('自分の件数', { exact: true }).fill('42')
  for (const [rank, count] of <[string, string][]>[['3', '55'], ['4', '44']]) {
    await form.getByRole('button', { name: '＋ 順位を追加' }).click()
    const n = await form.getByLabel(/行目の順位$/).count()
    await form.getByLabel(`${n}行目の順位`, { exact: true }).fill(rank)
    await form.getByLabel('件数', { exact: true }).nth(n - 1).fill(count)
  }
  await form.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText('🏆 リーダーボードを保存しました')).toBeVisible()

  await page.getByRole('button', { name: '自宅を出発' }).click()
  // 「クエスト」カードに、先に終わるクエストの件数。「件数を記録」で ＋／− と目標の行が開く
  await expect(page.getByRole('region', { name: 'クエスト' })).toContainText('40 / 50件')
  await page.getByRole('button', { name: '件数を記録' }).click()
  const push = page.getByRole('group', { name: 'あと何件？' })
  await expect(push).toContainText('日跨ぎ 40/50件')
  // この稼働で7件配達した
  for (let i = 0; i < 7; i++) await push.getByRole('button', { name: 'この稼働の件数を1件増やす' }).click()
  await expect(push).toContainText('日跨ぎ 47/50件')
  const goals = push.getByRole('list', { name: '日跨ぎの目標' }).getByRole('listitem')
  // 1時間2件（目安）：あと3件は約1時間30分、終了予定 21:00 までに届く
  await expect(goals.first()).toContainText('第2段階 50件：あと3件・約1時間30分・+1,170円')
  await expect(goals.first()).toContainText('✅ 21:00までに届く')
  // 4位（44件）はもう抜いたので、次は3位（55件）を抜く 56件。終了予定を延ばせば届く
  const third = goals.filter({ hasText: '3位を抜く' })
  await expect(third).toContainText('あと9件')
  await expect(third).toContainText('延ばすと届く')

  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])

  await page.reload()
  await expect(page.getByRole('region', { name: 'クエスト' })).toContainText('47 / 50件')
  await expect(page.getByRole('region', { name: 'クエスト' })).toContainText('あと3件で +1,170円')
  await page.getByRole('button', { name: '件数を記録' }).click()
  await expect(page.getByRole('group', { name: 'あと何件？' })).toContainText('日跨ぎ 47/50件')
})
