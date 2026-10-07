// 計画：この週の稼働量を決める画面（稼働の量・7日の帯・空いている稼げそうな時間）
import { expect, test, type Page } from '@playwright/test'

/** 主なエリア：毎日 17〜20時は段階4、11〜13時・21時は段階3、14・16・22時は段階2、ほかは段階1 */
async function addBusyArea(page: Page) {
  await page.goto('#settings')
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
}

test('開くと、この週の稼働の量・いつ働くか・空いている稼げそうな時間がひと目で出る', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+09:00') })
  await page.goto('#settings')
  await page.getByLabel('週に使える時間', { exact: true }).fill('15')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await addBusyArea(page)
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

test('クエスト達成に足す時間を逆算し、作戦の時間を帯に出して、まとめて候補枠に入れられる。作戦の軸でないクエストは 🎯 で出す', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+09:00') })
  await addBusyArea(page)
  // 平日クエスト（Uber）：20件で +3,000円、今 4件。週の終わりまでの出前館のクエスト：10件で +1,000円
  await page.goto('#home')
  await page.getByRole('button', { name: 'クエストを追加' }).click()
  await page.getByRole('button', { name: '🔁 毎週の平日（月4:00〜金4:00）' }).click()
  await page.getByLabel('名前', { exact: true }).fill('平日クエスト')
  await page.getByLabel('第1段階の件数', { exact: true }).fill('20')
  await page.getByLabel('報酬', { exact: true }).fill('3000')
  await page.getByLabel('この回の件数の調整（±）', { exact: true }).fill('4')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.locator('.subcard', { hasText: '平日クエスト' })).toContainText('4件／あと16件')
  await page.getByRole('button', { name: 'クエストを追加' }).click()
  await page.getByLabel('名前', { exact: true }).fill('出前館の週')
  await page.getByLabel('対象のサービス', { exact: true }).selectOption({ index: 1 })
  await page.getByLabel('開始', { exact: true }).fill('2026-10-05T04:00')
  await page.getByLabel('終了', { exact: true }).fill('2026-10-12T04:00')
  await page.getByLabel('第1段階の件数', { exact: true }).fill('10')
  await page.getByLabel('報酬', { exact: true }).fill('1000')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.locator('.subcard', { hasText: '出前館の週' })).toBeVisible()

  // 月曜 17〜21時の候補枠
  await page.goto('#plan')
  await page.getByRole('button', { name: '候補枠を追加' }).click()
  await page.getByLabel('出発', { exact: true }).fill('17:00')
  await page.getByLabel('帰宅', { exact: true }).fill('21:00')
  await page.getByRole('button', { name: '🔮 見込みを自動で入れる' }).click()
  await page.getByRole('button', { name: '💾 保存' }).click()

  // 先に終わる平日クエストが作戦の軸：あと16件を 月〜木に4件ずつ（2時間ずつ）。月曜は候補枠の4時間で足り、余りの2時間で木曜をまかなう
  const plan = page.getByRole('group', { name: 'クエスト作戦の時間' })
  await expect(plan).toContainText('🧭 平日クエスト 本命20件：この週 8h')
  const days = plan.getByRole('list', { name: '作戦の日ごとの時間' }).getByRole('listitem')
  await expect(days).toHaveCount(4)
  await expect(days.nth(0)).toContainText('選んだ枠で足りる')
  await expect(days.nth(1)).toContainText('火 10/6')
  await expect(days.nth(1)).toContainText('17:00〜19:00')
  await expect(days.nth(2)).toContainText('17:00〜19:00')
  await expect(days.nth(3)).toContainText('ほかの日の選んだ枠でまかなう')
  // 帯にも、火曜の行に 🎯 の時間が出る（作戦の 17〜19時と、出前館のための1時間）。「稼げそうな時間」は作戦の時間と重ならない
  await expect(page.getByRole('list', { name: 'この週の予定' }).getByRole('listitem').nth(1).locator('.wb-quest')).toHaveCount(2)
  await expect(page.getByRole('list', { name: '稼げそうな時間' })).not.toContainText('10/6(火) 17:00')
  // 作戦の軸でない出前館のクエストは 🎯：計画の8件（4時間×2件）で、あと2件＝1時間
  const targets = page.getByRole('list', { name: 'クエストのための時間' }).getByRole('listitem')
  await expect(targets).toHaveCount(1)
  await expect(targets.first()).toContainText('🎯 出前館の週 第1段階（+1,000円）まで あと1h')

  // ＋で作戦の時間をまとめて候補枠に入れる → 作戦は選んだ枠で足りる
  await plan.getByRole('button', { name: '作戦の時間を候補枠に入れる' }).click()
  await expect(page.getByText('🎯 2つの候補枠を入れました')).toBeVisible()
  await expect(page.getByRole('button', { name: /10\/6\(火\) 17:00〜19:00（✅ おすすめ）を編集/ })).toBeVisible()
  await expect(days.nth(1)).toContainText('選んだ枠で足りる')
  await expect(page.getByRole('region', { name: '🎯 クエストから見たこの週' })).toContainText('計画（8h）どおりなら 20件（第1段階まで・+3,000円）')

  // ↩ 元に戻すと、入れた枠は消える
  await page.getByRole('button', { name: '↩ 元に戻す' }).click()
  await expect(days.nth(1)).toContainText('17:00〜19:00')
  await expect(page.getByRole('button', { name: /10\/6\(火\) 17:00〜19:00/ })).toHaveCount(0)
})
