// 混み具合の地図（OpenStreetMap）：エリアの中心を地図のタップで決め、ホームの地図で混み具合の色の円を出し、▶ で時間を動かす。
// テストでは外の地図の画像を読み込まない（透明の画像を返す）
import { expect, test, type Page } from '@playwright/test'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

async function addArea(page: Page, name: string, levels: [number, number][], tap: { x: number; y: number }, primary: boolean) {
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill(name)
  for (const [hour, level] of levels) {
    const cell = page.getByRole('button', { name: new RegExp(`^月曜 ${hour}時`) })
    for (let i = 0; i < level; i++) await cell.click()
  }
  if (!primary) await page.getByLabel('主なエリアにする（計画と「続ける？帰る？」の見込みに使う）').uncheck()
  await page.getByText('🗺️ 地図の場所（任意）', { exact: true }).click()
  const map = page.getByRole('region', { name: /エリアの場所を決める地図/ })
  await expect(map).toBeVisible()
  await map.click({ position: tap })
  await expect(page.getByText('中心：設定済み（半径 1km）')).toBeVisible()
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText(name)).toBeVisible()
}

test('エリアの場所を地図で決めると、ホームの地図に混み具合の色の円が出て、▶ で時間が進む', async ({ page }) => {
  let tiles = 0
  await page.route('https://tile.openstreetmap.org/**', (route) => {
    tiles++
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
  })
  await page.clock.install({ time: new Date('2026-10-05T18:00:00+09:00') })
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'エリア' }).click()
  await addArea(page, '中野エリア', [[18, 4], [19, 2]], { x: 150, y: 120 }, true)
  await addArea(page, '新宿エリア', [[18, 1], [19, 4]], { x: 250, y: 150 }, false)
  // キーボードだけでも中心を決められる（矢印キーで地図を動かし、十字の位置を中心にする）
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('吉祥寺エリア')
  await page.getByText('🗺️ 地図の場所（任意）', { exact: true }).click()
  const keyMap = page.getByRole('region', { name: /エリアの場所を決める地図/ })
  await keyMap.focus()
  await page.keyboard.press('ArrowLeft')
  await page.getByRole('button', { name: '＋ 地図の真ん中（十字）を中心にする' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('中心：設定済み（半径 1km）')).toBeVisible()
  // 現在地は使わない（地図の会社にだいたいの現在地が伝わるため）
  await expect(page.getByRole('button', { name: /現在地/ })).toHaveCount(0)
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText('吉祥寺エリア')).toBeVisible()

  // 地図を開くまでは地図の画像を読み込まない
  await page.goto('#home')
  const before = tiles
  await expect(page.getByRole('region', { name: 'この先4時間の混み具合' })).toBeVisible()
  expect(tiles).toBe(before)
  await page.getByText('🗺️ 地図で見る（▶ でこの先4時間を動かす）').click()
  const map = page.getByRole('region', { name: /混み具合の地図/ })
  await expect(map).toHaveAttribute('aria-label', /18時（今）。中野エリア 段階4、吉祥寺エリア 未入力、新宿エリア 段階1/)
  await expect(page.locator('.map-label', { hasText: '中野エリア 4' })).toBeVisible()
  await expect(page.getByText('© OpenStreetMap', { exact: false })).toBeVisible()

  // つまみで1時間後へ
  await page.getByLabel('地図に出す時間').fill('1')
  await expect(map).toHaveAttribute('aria-label', /19時。中野エリア 段階2、吉祥寺エリア 未入力、新宿エリア 段階4/)
  await expect(page.locator('.map-label', { hasText: '新宿エリア 4' })).toBeVisible()

  // ▶ で1秒ごとに次の時間へ
  await page.getByRole('button', { name: '時間を進めて動かす' }).click()
  await page.clock.runFor(1000)
  await expect(map).toHaveAttribute('aria-label', /20時。/)
  await page.getByRole('button', { name: '止める' }).click()
})
