// 終了までの見通し：稼働中、オファーの記録から今日のペースを出し、続ける／休憩して再開／今やめるを比べる
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('終了予定を決めると、今日のペースとこの先の混み具合から、どうするのが得かを比べる', async ({ page }) => {
  // 月曜 17:00 に出発
  await page.clock.install({ time: new Date('2026-10-05T17:00:00+09:00') })
  await page.goto('#settings')
  await page.getByLabel('目標の営業純時給', { exact: true }).fill('1200')
  await page.getByLabel('オファー判定を使う（手入力）').check()
  await page.getByRole('button', { name: '💾 保存' }).click()
  // エリア：月曜19時台は空き、20時台は混む
  await page.getByRole('tab', { name: 'エリア' }).click()
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('中野・荻窪エリア')
  await page.getByRole('button', { name: /^月曜 19時/ }).click()
  const h20 = page.getByRole('button', { name: /^月曜 20時/ })
  for (let i = 0; i < 4; i++) await h20.click()
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.locator('.tag', { hasText: '主なエリア' })).toBeVisible()

  await page.goto('#home')
  await page.getByRole('button', { name: '🏠 自宅を出発' }).click()
  await expect(page.getByRole('heading', { name: /終了までの見通し/ })).toBeVisible()

  // 17:30 と 18:10 に受けたオファーを記録（合わせて 1,500円）
  for (const [time, text] of [
    ['2026-10-05T17:30:00+09:00', '¥600 合計 20 分 (2.0 km)'],
    ['2026-10-05T18:10:00+09:00', '¥900 合計 25 分 (3.0 km)'],
  ] as const) {
    await page.clock.setFixedTime(new Date(time))
    await page.goto(`#offer?text=${encodeURIComponent(text)}`)
    await page.getByRole('button', { name: '✅ 受けた' }).click()
    await expect(page.getByText('「受けた」と記録しました')).toBeVisible()
  }

  // 19:00 に見通しを見る。終了予定 21:00
  await page.clock.setFixedTime(new Date('2026-10-05T19:00:00+09:00'))
  await page.goto('#home')
  await page.getByLabel('終了予定（配達をやめる時刻）', { exact: true }).fill('21:00')
  await expect(page.getByText('あと2時間0分')).toBeVisible()
  await expect(page.getByText('1,500円・2件')).toBeVisible()
  await expect(page.locator('dd', { hasText: /^普段の\d+%$/ })).toBeVisible()
  await expect(page.getByLabel(/この先の混み具合：19時台 段階1、20時台 段階4/)).toBeVisible()
  const options = page.getByRole('list', { name: '行動ごとのこの先の利益' }).getByRole('listitem')
  await expect(options).toHaveCount(3)
  await expect(options.nth(0)).toContainText('このまま続ける')
  await expect(options.nth(1)).toContainText('60分休憩して再開')
  await expect(options.nth(2)).toContainText('今やめて帰る')
  // 空いてから混むので、休憩して再開がおすすめ（見込みは普段の半分のペースを反映）
  await expect(options.filter({ hasText: 'おすすめ' })).toContainText('60分休憩して再開')
  await expect(options.nth(1)).toContainText('+1,418円')
  await expect(page.getByText(/20時台は、今より混む見込みです（段階1→4）/)).toBeVisible()

  // 読み上げ・コントラストの自動チェック（稼働中のホームは一覧の確認に入らないので、ここで見る）
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)

  // 終了予定は、画面を開き直しても残る
  await page.reload()
  await expect(page.getByLabel('終了予定（配達をやめる時刻）', { exact: true })).toHaveValue('21:00')
})

test('移動の分を入れたエリアの方が見込みが良ければ、エリアの移動を勧める', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T18:30:00+09:00') })
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'エリア' }).click()
  // 主なエリア：月曜19・20時台は空き
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('中野・荻窪エリア')
  await page.getByRole('button', { name: /^月曜 19時/ }).click()
  await page.getByRole('button', { name: /^月曜 20時/ }).click()
  await page.getByRole('button', { name: '💾 保存' }).click()
  // 隣のエリア：月曜19・20時台は混む、移動15分
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('新宿エリア')
  for (const h of [19, 20]) {
    const cell = page.getByRole('button', { name: new RegExp(`^月曜 ${h}時`) })
    for (let i = 0; i < 4; i++) await cell.click()
  }
  await page.getByLabel('主なエリアにする（計画と「続ける？帰る？」の見込みに使う）').uncheck()
  await page.getByLabel('主なエリアからの移動（任意）', { exact: true }).fill('15')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText(/移動15分/)).toBeVisible()
  // もう1つのエリア：同じく混む、移動30分
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('吉祥寺エリア')
  for (const h of [19, 20]) {
    const cell = page.getByRole('button', { name: new RegExp(`^月曜 ${h}時`) })
    for (let i = 0; i < 4; i++) await cell.click()
  }
  await page.getByLabel('主なエリアにする（計画と「続ける？帰る？」の見込みに使う）').uncheck()
  await page.getByLabel('主なエリアからの移動（任意）', { exact: true }).fill('30')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText(/移動30分/)).toBeVisible()

  await page.goto('#home')
  await page.getByRole('button', { name: '🏠 自宅を出発' }).click()
  // 出発が保存されてから（カードが出てから）時刻を進めて読み直す
  await expect(page.getByRole('heading', { name: /終了までの見通し/ })).toBeVisible()
  await page.clock.setFixedTime(new Date('2026-10-05T19:00:00+09:00'))
  await page.reload()
  await expect(page.getByRole('heading', { name: /終了までの見通し/ })).toBeVisible()
  await page.getByLabel('終了予定（配達をやめる時刻）', { exact: true }).fill('21:00')
  const options = page.getByRole('list', { name: '行動ごとのこの先の利益' }).getByRole('listitem')
  await expect(options.filter({ hasText: 'おすすめ' })).toContainText('新宿エリアへ移動（15分）')
  await expect(page.getByText(/「新宿エリア」へ移動（15分）すると、移動の時間を引いても \+[\d,]+円（着く頃は段階4）/)).toBeVisible()

  await expect(options).toHaveCount(4)

  // 主なエリアを新宿に変えると、中野から測った吉祥寺への30分は使わない（入れ直すまで移動の案に出さない）
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'エリア' }).click()
  await page.getByRole('button', { name: '新宿エリアを編集' }).click()
  await page.getByLabel('主なエリアにする（計画と「続ける？帰る？」の見込みに使う）').check()
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText(/移動の分は入れ直し/)).toBeVisible()
  await page.getByRole('button', { name: '吉祥寺エリアを編集' }).click()
  await expect(page.getByText('前の主なエリアから測った値です')).toBeVisible()
  await page.getByRole('button', { name: 'やめる' }).click()
  await page.goto('#home')
  await expect(page.getByRole('heading', { name: /終了までの見通し/ })).toBeVisible()
  await expect(page.getByRole('list', { name: '行動ごとのこの先の利益' }).getByRole('listitem').filter({ hasText: '移動' })).toHaveCount(0)
})
