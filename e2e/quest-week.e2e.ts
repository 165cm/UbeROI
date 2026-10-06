// 計画：クエストを軸にした週の組み立て。選んだ候補枠でどの段階まで届くか、次の段階まで何時間足す価値があるか
import { expect, test } from '@playwright/test'

test('毎週のクエストと候補枠から、届く段階と、足す価値のある時間が計画に出る', async ({ page }) => {
  // 月曜の昼
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+09:00') })
  await page.goto('#settings')
  await page.getByLabel('目標の営業純時給', { exact: true }).fill('1500')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText('1,500円/時')).toBeVisible()

  // クエストがなければ、計画にカードは出ない
  await page.goto('#plan')
  await expect(page.getByRole('heading', { name: /この週の稼働/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /クエストから見たこの週/ })).toHaveCount(0)

  await page.goto('#home')
  await page.getByRole('button', { name: 'クエストを追加' }).click()
  await page.getByRole('button', { name: '🔁 毎週の平日（月4:00〜金4:00）' }).click()
  await page.getByLabel('名前', { exact: true }).fill('平日クエスト')
  await page.getByLabel('第1段階の件数', { exact: true }).fill('20')
  await page.getByLabel('報酬', { exact: true }).fill('3000')
  await page.getByLabel('この回の件数の調整（±）', { exact: true }).fill('4')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.locator('.subcard', { hasText: '平日クエスト' })).toContainText('4件／あと16件')

  // 計画：月曜 17〜21時（4時間）の候補枠
  await page.goto('#plan')
  await page.getByRole('button', { name: '候補枠を追加' }).click()
  await page.getByLabel('出発', { exact: true }).fill('17:00')
  await page.getByLabel('帰宅', { exact: true }).fill('21:00')
  await page.getByRole('button', { name: '🔮 見込みを自動で入れる' }).click()
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByRole('button', { name: /17:00〜21:00（✅ おすすめ）を編集/ })).toBeVisible()

  const card = page.locator('section', { has: page.getByRole('heading', { name: /クエストから見たこの週/ }) })
  // 目安 2件/時 × 4時間 = 8件 → 4 + 8 = 12件（第1段階の20件には届かない）
  await expect(card).toContainText('今 4件 → 計画（4h）どおりなら 12件（段階に届かない）')
  await card.getByText('段階ごとの見込み（1段階）').click()
  const table = card.getByRole('region', { name: '平日クエストの段階ごとの見込み' })
  const row = table.getByRole('row', { name: /第1段階/ })
  // あと8件 = 4時間。費用はレンタル代 2,400円 ÷ 4時間 = 600円/時 → ((1,400 − 600) × 4 + 3,000) ÷ 4 = 1,550円/時
  await expect(row.getByRole('cell')).toHaveText(['16件', '4時間', '1,550円/時'])
  await expect(card.getByRole('status')).toContainText('第1段階まで、あと4時間足すと、ボーナス込みの純時給が1,550円/時（目標以上）')
  await card.getByRole('button', { name: '＋ 候補枠を足す' }).click()
  await expect(page.getByLabel('出発', { exact: true })).toBeVisible()

  // 翌週はこの週の回が終わっているので、次の回（10/12〜）を出す
  await page.getByRole('button', { name: '← 計画へ戻る' }).click()
  await page.getByRole('button', { name: '次の週' }).click()
  await expect(card).toContainText(/10\/12.*〜10\/16/)
  await expect(card).toContainText('今 0件 → 計画（0h）どおりなら 0件（段階に届かない）')
})

test('毎日のクエストは、表示している週のこれからの回をすべて出す', async ({ page }) => {
  // 金曜の昼：金・土・日の3回が残っている
  await page.clock.install({ time: new Date('2026-10-09T12:00:00+09:00') })
  await page.goto('#home')
  await page.getByRole('button', { name: 'クエストを追加' }).click()
  await page.getByLabel('名前', { exact: true }).fill('毎日クエスト')
  await page.getByLabel('開始', { exact: true }).fill('2026-10-05T04:00')
  await page.getByLabel('終了', { exact: true }).fill('2026-10-06T04:00')
  await page.getByLabel('くり返し', { exact: true }).selectOption('daily')
  await page.getByLabel('第1段階の件数', { exact: true }).fill('5')
  await page.getByLabel('報酬', { exact: true }).fill('500')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.locator('.subcard', { hasText: '毎日クエスト' }).first()).toBeVisible()

  await page.goto('#plan')
  const card = page.getByRole('region', { name: '🎯 クエストから見たこの週' })
  await expect(card.getByText('段階ごとの見込み（1段階）')).toHaveCount(3)
  await expect(card).toContainText(/10\/9.*〜10\/10/)
  await expect(card).toContainText(/10\/11.*〜10\/12/)
})
