// 計画：この週の稼働量を決める画面（稼働の量・7日の帯・空いている稼げそうな時間）
import { expect, test } from '@playwright/test'

test('開くと、この週の稼働の量・いつ働くか・空いている稼げそうな時間がひと目で出る', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+09:00') })
  await page.goto('#settings')
  await page.getByLabel('週に使える時間', { exact: true }).fill('15')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await page.getByRole('tab', { name: 'エリア' }).click()
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('中野エリア')
  for (let h = 0; h < 24; h++) {
    const lv = h >= 17 && h <= 20 ? 4 : (h >= 11 && h <= 13) || h === 21 ? 3 : h === 14 || h === 16 || h === 22 ? 2 : 1
    const cell = page.getByRole('button', { name: new RegExp('^月曜 ' + h + '時') })
    for (let i = 0; i < lv; i++) await cell.click()
  }
  await page.getByRole('button', { name: '📋 全曜日に写す' }).click()
  await page.getByRole('button', { name: '💾 保存' }).click()
  await page.goto('#plan')
  // 主なエリアの混み具合があれば、予定がなくても稼げそうな時間を出す（月曜の17〜20時：1,400円 × 1.35 × 3時間）
  await expect(page.getByRole('list', { name: '稼げそうな時間' }).getByRole('listitem').first()).toContainText('10/5(月) 17:00〜20:00')
  for (const [d, s, e] of <[string, string, string][]>[['2026-10-05', '18:00', '21:00'], ['2026-10-08', '17:00', '21:00'], ['2026-10-10', '11:00', '15:00']]) {
    await page.getByRole('button', { name: '候補枠を追加' }).click()
    await page.getByLabel('日付', { exact: true }).fill(d)
    await page.getByLabel('出発', { exact: true }).fill(s)
    await page.getByLabel('帰宅', { exact: true }).fill(e)
    await page.getByRole('button', { name: '🔮 見込みを自動で入れる' }).click()
    await page.getByRole('button', { name: '💾 保存' }).click()
  }
  // 3つ目の保存が終わってから（帯に3つの四角が出てから）時刻を進めて読み直す
  await expect(page.getByRole('button', { name: /（✅ おすすめ）を編集$/ })).toHaveCount(3)
  await page.clock.setFixedTime(new Date('2026-10-07T12:00:00+09:00'))
  await page.reload()
  await expect(page.getByRole('heading', { name: /この週の稼働/ })).toBeVisible()
  // ① 稼働の量：月曜の枠は過ぎたので、これからは木・土の8時間。上限15時間まであと7時間
  const amount = page.getByRole('region', { name: '⏱️ この週の稼働' })
  await expect(amount.getByRole('definition')).toHaveText(['0h', '8h', '7h'])
  await expect(amount.getByRole('img')).toHaveAccessibleName('実績0h、これから8h、上限15h')
  // ② 7日の帯：おすすめの枠は帯の上の四角（押すと編集）、その日の時間を右に
  const days = page.getByRole('list', { name: 'この週の予定' }).getByRole('listitem')
  await expect(days).toHaveCount(7)
  await expect(days.nth(3)).toContainText('木 8')
  await expect(days.nth(3)).toContainText('4h')
  await expect(page.getByRole('button', { name: /^水 7日に枠を足す$/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^月 5日に枠を足す$/ })).toHaveCount(0)
  // ③ 空いている稼げそうな時間：予定と重ならない時間を1日1つ、最大3つ
  const suggest = page.getByRole('list', { name: '稼げそうな時間' }).getByRole('listitem')
  await expect(suggest).toHaveCount(3)
  await expect(suggest.nth(0)).toContainText('10/7(水) 17:00〜20:00')
  await expect(suggest.nth(0)).toContainText('約5,670円')
  await expect(suggest.nth(1)).toContainText('10/9(金) 17:00〜20:00')
  // くわしい比べ方・一覧は畳んである
  await expect(page.getByRole('heading', { name: /この週のおすすめ/ })).toBeHidden()

  // ＋で、見込みの入った候補枠の入力が開く
  await suggest.nth(0).getByRole('button', { name: '10/7(水) 17:00〜20:00を候補枠に入れる' }).click()
  await expect(page.getByLabel('日付', { exact: true })).toHaveValue('2026-10-07')
  await expect(page.getByLabel('出発', { exact: true })).toHaveValue('17:00')
  await expect(page.getByLabel('帰宅', { exact: true })).toHaveValue('20:00')
  await expect(page.getByLabel('標準の売上', { exact: true })).toHaveValue('5670')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(amount.getByRole('definition')).toHaveText(['0h', '11h', '4h'])
  await expect(suggest.nth(0)).not.toContainText('10/7(水)')

  // 帯の四角を押すと、その枠の編集が開く
  await page.getByRole('button', { name: /10\/8\(木\) 17:00〜21:00（✅ おすすめ）を編集/ }).click()
  await expect(page.getByLabel('日付', { exact: true })).toHaveValue('2026-10-08')
})

test('混み具合がない時は、入れ方を案内する', async ({ page }) => {
  await page.goto('#plan')
  await expect(page.getByRole('region', { name: '💡 空いている、稼げそうな時間' })).toContainText('設定 → エリアで主なエリアの混み具合を入れると')
  await expect(page.getByRole('region', { name: '⏱️ この週の稼働' })).toContainText('「週に使える時間」を入れると')
})

test('この週の実績の時間を上限から引いて、残りの時間に入る枠だけをおすすめにする', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T17:00:00+09:00') })
  await page.goto('#settings')
  await page.getByLabel('週に使える時間', { exact: true }).fill('6')
  await page.getByRole('button', { name: '💾 保存' }).click()
  // 月曜 17〜20時に3時間働いた（確定）
  await page.goto('#home')
  await page.getByRole('button', { name: '🏠 自宅を出発' }).click()
  await expect(page.getByRole('heading', { name: /稼働中/ })).toBeVisible()
  await page.clock.fastForward('03:00:00')
  await page.getByRole('button', { name: '🏁 帰宅して精算' }).click()
  await page.getByLabel('基本報酬（配送料の合計）', { exact: true }).fill('4000')
  await page.getByRole('button', { name: '✅ 確定して保存' }).click()
  await expect(page.locator('.list-item').first()).toBeVisible()

  // 水曜 17〜21時（4時間）と木曜 17〜20時（3時間）。残りは 6 − 3 = 3時間なので、入るのは木曜だけ
  await page.goto('#plan')
  for (const [d, e] of [['2026-10-07', '21:00'], ['2026-10-08', '20:00']] as const) {
    await page.getByRole('button', { name: '候補枠を追加' }).click()
    await page.getByLabel('日付', { exact: true }).fill(d)
    await page.getByLabel('出発', { exact: true }).fill('17:00')
    await page.getByLabel('帰宅', { exact: true }).fill(e)
    await page.getByRole('button', { name: '🔮 見込みを自動で入れる' }).click()
    await page.getByRole('button', { name: '💾 保存' }).click()
  }
  const amount = page.getByRole('region', { name: '⏱️ この週の稼働' })
  await expect(amount.getByRole('definition')).toHaveText(['3h', '3h', '0h'])
  await expect(page.getByRole('button', { name: /10\/8\(木\) 17:00〜20:00（✅ おすすめ）を編集/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /10\/7\(水\) 17:00〜21:00（選ばれなかった候補）を編集/ })).toBeVisible()
  // 月曜の帯に実績、その日の時間は 3h
  await expect(page.getByRole('list', { name: 'この週の予定' }).getByRole('listitem').first()).toContainText('3h')
})
