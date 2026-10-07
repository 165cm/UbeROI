// 天気：主なエリアの場所から天気予報（Open-Meteo・気象庁）を取り、計画の帯に日ごとの天気と雨・荒天の時間を出す。
// 日の天気は押して手で直せる。記録の天気は1タップ。テストでは外の天気予報を読み込まず、作った予報を返す
import { expect, test, type Page } from '@playwright/test'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

/** 10/5（月）から8日分：土曜 10/10 の 10〜20時は雨（2mm）、日曜 10/11 の 12時は大雨（8mm）、ほかは晴れ */
function forecastBody() {
  const time: string[] = []
  const precipitation: number[] = []
  const weather_code: number[] = []
  const wind_gusts_10m: number[] = []
  for (let d = 0; d < 8; d++) {
    for (let h = 0; h < 24; h++) {
      const day = 5 + d
      time.push(`2026-10-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`)
      const rain = day === 10 && h >= 10 && h < 20 ? 2 : day === 11 && h === 12 ? 8 : 0
      precipitation.push(rain)
      weather_code.push(rain >= 5 ? 65 : rain > 0 ? 61 : 1)
      wind_gusts_10m.push(4)
    }
  }
  return { hourly: { time, precipitation, weather_code, wind_gusts_10m } }
}

async function primaryAreaWithCenter(page: Page) {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'エリア' }).click()
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('中野エリア')
  await page.getByText('🗺️ 地図の場所（任意）', { exact: true }).click()
  // 地図の真ん中（日本全体の表示：北緯36.5・東経138）を中心にする
  await page.getByRole('button', { name: '＋ 地図の真ん中（十字）を中心にする' }).click()
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText('中野エリア')).toBeVisible()
}

test('主なエリアの場所（約10kmに丸めた緯度経度だけ）から天気予報を取り、帯に日ごとの天気と雨・荒天の時間を出す。日の天気は手で直せる', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+09:00') })
  const asked: string[] = []
  await page.route('https://api.open-meteo.com/**', (route) => {
    asked.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecastBody()), headers: { 'access-control-allow-origin': '*' } })
  })
  await primaryAreaWithCenter(page)
  // 計画を開くまでは取りに行かない
  expect(asked).toEqual([])

  await page.goto('#plan')
  await expect(page.getByText(/天気：Open-Meteo（気象庁）/)).toBeVisible()
  expect(asked).toHaveLength(1)
  const url = new URL(asked[0]!)
  expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/jma')
  expect(url.searchParams.get('latitude')).toBe('36.5')
  expect(url.searchParams.get('longitude')).toBe('138')

  await expect(page.getByRole('button', { name: '土 10日の天気：雨（予報）。押すと変える' })).toHaveText('☔')
  await expect(page.getByRole('button', { name: '日 11日の天気：荒天（予報）。押すと変える' })).toHaveText('⛈️')
  await expect(page.getByRole('button', { name: '金 9日の天気：晴れ（予報）。押すと変える' })).toHaveText('☀️')
  const days = page.getByRole('list', { name: 'この週の予定' }).getByRole('listitem')
  await expect(days.nth(5).locator('.wb-rain')).toHaveCount(10)
  await expect(days.nth(6).locator('.wb-storm')).toHaveCount(1)

  // 金曜を手で直す：晴れ → くもり → 雨（読み直しても残る）
  await page.getByRole('button', { name: /^金 9日の天気/ }).click()
  await expect(page.getByRole('button', { name: '金 9日の天気：晴れ（手で直した）。押すと変える' })).toBeVisible()
  await page.getByRole('button', { name: /^金 9日の天気/ }).click()
  await page.getByRole('button', { name: /^金 9日の天気/ }).click()
  await expect(page.getByRole('button', { name: '金 9日の天気：雨（手で直した）。押すと変える' })).toHaveText('☔')
  await page.reload()
  await expect(page.getByRole('button', { name: '金 9日の天気：雨（手で直した）。押すと変える' })).toBeVisible()
  // 3時間は端末に覚えた予報を使い、取り直さない
  expect(asked).toHaveLength(1)
  // 荒天の次は予報に戻る
  await page.getByRole('button', { name: /^金 9日の天気/ }).click()
  await page.getByRole('button', { name: /^金 9日の天気/ }).click()
  await expect(page.getByRole('button', { name: '金 9日の天気：晴れ（予報）。押すと変える' })).toBeVisible()
})

test('天気予報が届かない時は、手で入れるよう案内する。主なエリアに場所がなければ取りに行かない', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+09:00') })
  let asked = 0
  await page.route('https://api.open-meteo.com/**', (route) => {
    asked++
    return route.fulfill({ status: 503, body: '' })
  })
  await page.goto('#plan')
  await expect(page.getByText(/主なエリアに地図の場所を入れると、天気予報を自動で入れます/)).toBeVisible()
  expect(asked).toBe(0)
  await primaryAreaWithCenter(page)
  await page.goto('#plan')
  await expect(page.getByText('天気予報を取得できませんでした。日ごとの天気を押して手で入れられます', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: /^土 10日の天気/ }).click()
  await expect(page.getByRole('button', { name: '土 10日の天気：晴れ（手で直した）。押すと変える' })).toBeVisible()
})

test('記録の天気は1タップで選び、押し直すと外せる', async ({ page }) => {
  await page.goto('#records')
  await page.getByRole('button', { name: /過去の稼働をまとめて入力/ }).click()
  const rain = page.getByRole('group', { name: '天気' }).getByRole('button', { name: '🌦️ 小雨' })
  await rain.click()
  await expect(rain).toHaveAttribute('aria-pressed', 'true')
  await rain.click()
  await expect(rain).toHaveAttribute('aria-pressed', 'false')
})
