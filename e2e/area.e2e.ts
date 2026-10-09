// 設定・エリア：配達アプリの「時間帯ごとの傾向」を写し、主なエリアとして計画の見込みとホームに使う
import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('エリアの混み具合を登録すると、ホームに今の混み具合が出て、計画の見込みに使われる', async ({ page }) => {
  // 月曜 18:00（日本時間）
  await page.clock.install({ time: new Date('2026-10-05T18:00:00+09:00') })
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'エリア' }).click()
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('中野・荻窪エリア')

  // 月曜 18時を4（4回押す）、19時を3（3回押す）
  const h18 = page.getByRole('button', { name: /^月曜 18時/ })
  for (let i = 0; i < 4; i++) await h18.click()
  await expect(h18).toHaveAccessibleName('月曜 18時：混む')
  const h19 = page.getByRole('button', { name: /^月曜 19時/ })
  for (let i = 0; i < 3; i++) await h19.click()
  // 月曜を火曜に写す
  await page.getByRole('tab', { name: '火' }).click()
  await page.getByRole('button', { name: '⬅ 月曜と同じ' }).click()
  await expect(page.getByRole('button', { name: /^火曜 18時/ })).toHaveAccessibleName('火曜 18時：混む')

  await page.getByLabel('このエリアに入る地名（任意）').fill('高円寺、阿佐谷')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText(/4\/168マス・地名2/)).toBeVisible()
  await expect(page.locator('.tag', { hasText: '主なエリア' })).toBeVisible()

  // ホーム：この先4時間の表。今（18時台）は混む、19時台はやや混む、20・21時台は未入力
  await page.goto('#home')
  await page.getByText('📋 判断のたすけ').click()
  const ahead = page.getByRole('region', { name: 'この先4時間の混み具合' })
  await expect(ahead.getByRole('columnheader')).toHaveText(['📈 エリア', '今 18時', '19時', '20時', '21時'])
  const row = ahead.getByRole('row', { name: /中野・荻窪エリア/ })
  await expect(row.getByRole('cell').nth(0)).toHaveAccessibleName('段階4 混む')
  await expect(row.getByRole('cell').nth(1)).toHaveAccessibleName('段階3 やや混む')
  await expect(row.getByRole('cell').nth(2)).toHaveAccessibleName('未入力')
  // 未入力のマスがあるので「一番混む」は出さない（エリアが1つの時は比べない）
  await expect(page.getByText(/一番混むのは/)).toHaveCount(0)

  // 計画：月曜 18〜20時の候補で見込みを自動で入れると、混み具合を使った推計になる
  await page.goto('#plan')
  await page.getByRole('tab', { name: '予定' }).click()
  await page.getByRole('button', { name: '候補枠を追加' }).click()
  await page.getByLabel('出発', { exact: true }).fill('18:00')
  await page.getByLabel('帰宅', { exact: true }).fill('20:00')
  await page.getByRole('button', { name: '🔮 見込みを自動で入れる' }).click()
  await expect(page.getByText(/エリアの混み具合を使用/)).toBeVisible()
  // 1,400円 × (1.35 + 1.10) = 3,430円
  await expect(page.getByLabel('標準の売上', { exact: true })).toHaveValue('3430')
})

/** 配達アプリの「時間帯ごとの傾向」と同じ並び・比率の合成スクリーンショット（PNG）を、ブラウザーの中で描いて作る */
async function fakeShot(page: import('@playwright/test').Page, levels: number[], dot: number | null, jpeg = false): Promise<Buffer> {
  const b64 = await page.evaluate(
    ({ levels, dot, jpeg }) => {
      const c = document.createElement('canvas')
      c.width = 750
      c.height = 1334
      const g = c.getContext('2d')!
      const rect = (x: number, y: number, w: number, h: number, color: string) => {
        g.fillStyle = color
        g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
      }
      rect(0, 0, 750, 1334, 'rgb(40,48,62)')
      rect(50, 810, 650, 405, 'rgb(30,30,30)')
      const shades = [0, 200, 160, 110, 75]
      const pitch = 24.55
      levels.forEach((lv, i) => rect(78 + i * pitch, 1141 - lv * pitch * 1.6, 20, lv * pitch * 1.6, `rgb(${shades[lv]},${shades[lv]},${shades[lv]})`))
      if (dot !== null) for (let k = 0; k < 7; k++) rect(374.5 + (k - 3) * pitch * 1.466 - 5, 1288, 10, 10, k === dot ? '#fff' : 'rgb(100,100,100)')
      return c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', .65).split(',')[1]!
    },
    { levels, dot, jpeg },
  )
  return Buffer.from(b64, 'base64')
}

test('混み具合のスクリーンショットを選ぶと、棒の段階と曜日を読み取り、確かめてから表に入れられる', async ({ page }) => {
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'エリア' }).click()
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('中野・荻窪エリア')

  const sunday = [2, 1, 3, 3, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4]
  const noDots = [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 1, 2, 3, 4, 1, 2, 3, 4]
  await page.getByLabel('📷 スクショから読み取る').setInputFiles([
    { name: 'sunday.png', mimeType: 'image/png', buffer: await fakeShot(page, sunday, 6) },
    { name: 'next.png', mimeType: 'image/png', buffer: await fakeShot(page, noDots, null) },
    { name: 'map.png', mimeType: 'image/png', buffer: await fakeShot(page, [], 2) },
  ])
  // 1枚目は点から日曜、2枚目は点がないので順番で月曜（？付き）、3枚目は読めない
  await expect(page.getByLabel('1枚目の曜日', { exact: true })).toHaveValue('0')
  await expect(page.getByRole('img', { name: `1枚目：${sunday.join('')}` })).toBeVisible()
  await expect(page.getByLabel('2枚目の曜日', { exact: true })).toHaveValue('-1')
  await expect(page.getByText(/棒グラフを読めませんでした/)).toBeVisible()
  // 同じ曜日にすると入れられない。直すと入れられる
  await page.getByLabel('2枚目の曜日', { exact: true }).selectOption('0')
  await expect(page.getByText(/同じ曜日が2枚あります/)).toBeVisible()
  await page.getByLabel('2枚目の曜日', { exact: true }).selectOption('6')
  await expect(page.getByRole('button', { name: '✅ 2曜日分を表に入れる' })).toBeDisabled()
  await page.getByLabel('1枚目の曜日と24時間の値を確認した').check()
  await page.getByLabel('2枚目の曜日と24時間の値を確認した').check()
  await page.getByRole('button', { name: '✅ 2曜日分を表に入れる' }).click()

  // 表：日曜 4時=2・5時=1・3時=4、土曜 4時=1・19時=4
  await expect(page.getByRole('button', { name: /^日曜 4時/ })).toHaveAccessibleName('日曜 4時：やや空き')
  await expect(page.getByRole('button', { name: /^日曜 5時/ })).toHaveAccessibleName('日曜 5時：空き')
  await expect(page.getByRole('button', { name: /^日曜 3時/ })).toHaveAccessibleName('日曜 3時：混む')
  await page.getByRole('tab', { name: '土' }).click()
  await expect(page.getByRole('button', { name: /^土曜 4時/ })).toHaveAccessibleName('土曜 4時：空き')
  await expect(page.getByRole('button', { name: /^土曜 19時/ })).toHaveAccessibleName('土曜 19時：混む')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText(/48\/168マス/)).toBeVisible()
})

test('元画像を見て誤読を修正し、選んだ曜日だけ更新・取り消し・保存できる', async ({ page }, info) => {
  test.setTimeout(60_000)
  await page.clock.install({ time: new Date('2026-10-10T12:00:00+09:00') })
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'エリア' }).click()
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('確認用エリア')
  await page.getByLabel('配達アプリで確かめた日').fill('2026-09-01')
  await page.getByRole('button', { name: /^月曜 4時/ }).click()
  await page.getByRole('tab', { name: '火', exact: true }).click()
  await page.getByRole('button', { name: /^火曜 5時/ }).click()
  await page.getByRole('button', { name: '💾 保存' }).click()
  await page.getByRole('button', { name: '確認用エリアを編集' }).click()
  const levels = Array.from({ length: 24 }, (_, h) => h % 4 + 1)
  const file = { name: 'monday.jpg', mimeType: 'image/jpeg', buffer: await fakeShot(page, levels, 0, true) }
  const upload = () => page.getByLabel('📷 スクショから読み取る').setInputFiles(file)
  await upload()
  await expect(page.getByRole('img', { name: '1枚目の棒グラフ（元画像から拡大）', exact: true })).toBeVisible()
  const confirm = page.getByLabel('1枚目の曜日と24時間の値を確認した')
  await confirm.check()
  await page.getByLabel('1枚目 4時の段階').selectOption('4')
  await expect(confirm).not.toBeChecked()
  await expect(page.getByRole('button', { name: '✅ 1曜日分を表に入れる' })).toBeDisabled()
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    for (const width of [320, 390, 844, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: info.outputPath(`area-review-${colorScheme}.png`), fullPage: true })
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([])
  }
  await confirm.check()
  await page.getByRole('button', { name: '✅ 1曜日分を表に入れる' }).click()
  await expect(page.getByRole('button', { name: /^月曜 4時/ })).toHaveAccessibleName('月曜 4時：混む')
  await page.getByRole('button', { name: /元に戻す/ }).click()
  await expect(page.getByRole('button', { name: /^月曜 4時/ })).toHaveAccessibleName('月曜 4時：空き')
  await upload()
  await confirm.check()
  await page.getByRole('button', { name: '✅ 1曜日分を表に入れる' }).click()
  await page.getByRole('button', { name: '💾 保存' }).click()
  await page.getByRole('button', { name: '確認用エリアを編集' }).click()
  await expect(page.getByText('月曜の確認日：2026-10-10')).toBeVisible()
  await page.getByRole('tab', { name: '火', exact: true }).click()
  await expect(page.getByRole('button', { name: /^火曜 5時/ })).toHaveAccessibleName('火曜 5時：空き')
  await expect(page.getByText('火曜の確認日：2026-09-01')).toBeVisible()
})

test('ホームのこの先4時間：登録したエリアは未入力でも並べ、4時間そろったエリアだけで一番混むところを知らせる', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T18:00:00+09:00') })
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'エリア' }).click()
  const add = async (name: string, cells: [number, number, number][]) => {
    await page.getByRole('button', { name: 'エリアを追加' }).click()
    await page.getByLabel('エリアの名前', { exact: true }).fill(name)
    for (const [day, hour, level] of cells) {
      const label = ['日', '月', '火', '水', '木', '金', '土'][day]!
      if (label !== '月') await page.getByRole('tab', { name: label }).click()
      const cell = page.getByRole('button', { name: new RegExp(`^${label}曜 ${hour}時`) })
      for (let i = 0; i < level; i++) await cell.click()
      if (label !== '月') await page.getByRole('tab', { name: '月' }).click()
    }
    await page.getByRole('button', { name: '💾 保存' }).click()
    await expect(page.getByText(name)).toBeVisible()
  }
  // 中野：月曜18〜21時がすべて段階3。新宿：18時だけ段階4。吉祥寺：火曜だけ入力
  await add('中野エリア', [[1, 18, 3], [1, 19, 3], [1, 20, 3], [1, 21, 3]])
  await add('新宿エリア', [[1, 18, 4]])
  await add('吉祥寺エリア', [[2, 18, 2]])
  await page.goto('#home')
  await page.getByText('📋 判断のたすけ').click()
  const ahead = page.getByRole('region', { name: 'この先4時間の混み具合' })
  await expect(ahead.getByRole('row')).toHaveCount(4)
  await expect(ahead.getByRole('row', { name: /吉祥寺エリア/ }).getByRole('cell').nth(0)).toHaveAccessibleName('未入力')
  await expect(page.getByText(/一番混むのは 中野エリア（3）/)).toBeVisible()
  await expect(page.getByText('未入力のマスがあるエリア（2つ）は比べていません。')).toBeVisible()
})

test('自動で読めない画像も、目視で24時間を入力して取り込める', async ({ page }) => {
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'エリア' }).click()
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('📷 スクショから読み取る').setInputFiles({ name: 'unreadable.png', mimeType: 'image/png', buffer: await fakeShot(page, [], null) })
  await page.getByLabel('この画像を更新に使う').check()
  await page.getByLabel('1枚目の曜日', { exact: true }).selectOption('3')
  await expect(page.getByLabel('1枚目の曜日と24時間の値を確認した')).toBeDisabled()
  for (let hour = 0; hour < 24; hour++) await page.getByLabel(`1枚目 ${hour}時の段階`, { exact: true }).selectOption('2')
  await page.getByLabel('1枚目の曜日と24時間の値を確認した').check()
  await page.getByRole('button', { name: '✅ 1曜日分を表に入れる' }).click()
  await expect(page.getByRole('button', { name: /^水曜 4時/ })).toHaveAccessibleName('水曜 4時：やや空き')
  await expect(page.getByRole('button', { name: /^水曜 3時/ })).toHaveAccessibleName('水曜 3時：やや空き')
})
