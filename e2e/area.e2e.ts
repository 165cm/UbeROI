// 設定・エリア：配達アプリの「時間帯ごとの傾向」を写し、主なエリアとして計画の見込みとホームに使う
import { expect, test } from '@playwright/test'

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

  // ホーム：今（18時台）は混む、1時間後（19時台）はやや混む
  await page.goto('#home')
  await expect(page.locator('.busy-now')).toContainText('今 ▮▮▮▮ 混む → 1時間後 ▮▮▮▯ やや混む')

  // 計画：月曜 18〜20時の候補で見込みを自動で入れると、混み具合を使った推計になる
  await page.goto('#plan')
  await page.getByRole('button', { name: '候補枠を追加' }).click()
  await page.getByLabel('出発', { exact: true }).fill('18:00')
  await page.getByLabel('帰宅', { exact: true }).fill('20:00')
  await page.getByRole('button', { name: '🔮 見込みを自動で入れる' }).click()
  await expect(page.getByText(/エリアの混み具合を使用/)).toBeVisible()
  // 1,400円 × (1.35 + 1.10) = 3,430円
  await expect(page.getByLabel('標準の売上', { exact: true })).toHaveValue('3430')
})

/** 配達アプリの「時間帯ごとの傾向」と同じ並び・比率の合成スクリーンショット（PNG）を、ブラウザーの中で描いて作る */
async function fakeShot(page: import('@playwright/test').Page, levels: number[], dot: number | null): Promise<Buffer> {
  const b64 = await page.evaluate(
    ({ levels, dot }) => {
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
      return c.toDataURL('image/png').split(',')[1]!
    },
    { levels, dot },
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
  await expect(page.getByLabel('1枚目の曜日')).toHaveValue('0')
  await expect(page.getByRole('img', { name: `1枚目：${sunday.join('')}` })).toBeVisible()
  await expect(page.getByLabel('2枚目の曜日')).toHaveValue('1')
  await expect(page.getByLabel('2枚目の曜日').locator('option:checked')).toHaveText('月曜？')
  await expect(page.getByText('棒グラフを読めませんでした')).toBeVisible()
  // 同じ曜日にすると入れられない。直すと入れられる
  await page.getByLabel('2枚目の曜日').selectOption('0')
  await expect(page.getByText('同じ曜日が2枚あります')).toBeVisible()
  await page.getByLabel('2枚目の曜日').selectOption('6')
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
