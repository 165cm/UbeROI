// 計画：🧭 今週の作戦（天気・レンタルの上限・働ける時間・クエストから、稼げる日に長く1回借りる組み合わせ）
import { expect, test, type Page } from '@playwright/test'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

/** 10/5（月）から8日分：日曜 10/11 は一日中雨（2mm）、ほかは晴れ */
function forecastBody() {
  const time: string[] = []
  const precipitation: number[] = []
  const weather_code: number[] = []
  const wind_speed_10m: number[] = []
  for (let d = 0; d < 8; d++) {
    for (let h = 0; h < 24; h++) {
      const day = 5 + d
      time.push(`2026-10-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:00`)
      const rain = day === 11 ? 2 : 0
      precipitation.push(rain)
      weather_code.push(rain > 0 ? 61 : 1)
      wind_speed_10m.push(3)
    }
  }
  return { hourly: { time, precipitation, weather_code, wind_speed_10m } }
}

async function setWeeklyHours(page: Page, hours: string) {
  await page.goto('#settings')
  await page.getByLabel('週に使える時間', { exact: true }).fill(hours)
  await page.getByRole('button', { name: '💾 保存' }).first().click()
}

test('雨の日曜に1回長く借りて働く作戦をおすすめにし、天気を直すと作戦も変わる。＋で予定に入る', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+09:00') })
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  await page.route('https://api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecastBody()), headers: { 'access-control-allow-origin': '*' } }),
  )
  await setWeeklyHours(page, '10')
  // 働ける時間：土日中心（土日 9〜22時）
  await page.getByRole('button', { name: '働ける時間を編集' }).click()
  await page.getByRole('button', { name: '📅 土日中心' }).click()
  await page.getByRole('button', { name: '💾 保存' }).last().click()
  await expect(page.getByText(/働ける時間を保存しました/)).toBeVisible()
  // 主なエリア（天気予報の場所）
  await page.getByRole('tab', { name: 'エリア' }).click()
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('中野エリア')
  await page.getByText('🗺️ 地図の場所（任意）', { exact: true }).click()
  await page.getByRole('button', { name: '＋ 地図の真ん中（十字）を中心にする' }).click()
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText('中野エリア')).toBeVisible()

  await page.goto('#plan')
  await expect(page.getByRole('button', { name: '日 11日の天気：雨（予報）。押すと変える' })).toBeVisible()
  const options = page.getByRole('radiogroup', { name: '作戦の選択肢' }).getByRole('radio')
  await expect(options.first()).toContainText('おすすめ')
  await expect(options.first()).toHaveAttribute('aria-checked', 'true')
  // 週の上限10時間を、雨の日曜に1回（レンタルは上限 2,500円）
  await expect(options.first()).toContainText('1日・10h')
  const plan = page.getByRole('group', { name: '作戦の日ごとの時間' })
  const rows = plan.getByRole('list', { name: '作戦の日ごと' }).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('日 10/11')
  await expect(rows.first()).toContainText('10h')
  await expect(rows.first()).toContainText('🚲2,500円')
  // 帯にも作戦の時間（🧭）が日曜に出る
  await expect(page.getByRole('list', { name: 'この週の予定' }).getByRole('listitem').nth(6).locator('.wb-quest').first()).toBeVisible()
  await expect(page.getByRole('list', { name: 'この週の予定' }).getByRole('listitem').nth(5).locator('.wb-quest')).toHaveCount(0)

  // 日曜を晴れに直すと、雨の分の上乗せがなくなり、土曜の稼げる時間も使う作戦に変わる
  await page.getByRole('button', { name: /^日 11日の天気/ }).click()
  await expect(page.getByRole('button', { name: '日 11日の天気：晴れ（手で直した）。押すと変える' })).toBeVisible()
  await expect(rows.filter({ hasText: '土 10/10' })).toHaveCount(1)
  // 雨に戻すと、また日曜1日にまとめる
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: /^日 11日の天気/ }).click()
  await expect(page.getByRole('button', { name: '日 11日の天気：雨（手で直した）。押すと変える' })).toBeVisible()
  await expect(options.first()).toContainText('1日・10h')

  // ＋で作戦の時間を候補枠に入れる
  await plan.getByRole('button', { name: '作戦の時間を候補枠に入れる' }).click()
  await expect(page.getByText(/🧭 \dつの候補枠を入れました/)).toBeVisible()
  await expect(page.getByRole('button', { name: /10\/11\(日\).*（✅ おすすめ）を編集$/ }).first()).toBeVisible()
  // 入れた日は、その枠で固定（選んだ候補枠）として作戦に出る
  await expect(rows.first()).toContainText('選んだ候補枠')
})

test('日跨ぎの段階ごとに、作戦の選択肢（最低・本命・クエストを気にしない）を比べて選べる', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+09:00') })
  await page.goto('#settings')
  await page.getByLabel('目標の営業純時給', { exact: true }).fill('1500')
  await page.getByRole('button', { name: '💾 保存' }).first().click()
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
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.locator('.subcard', { hasText: '日跨ぎ' })).toBeVisible()

  await page.goto('#plan')
  const options = page.getByRole('radiogroup', { name: '作戦の選択肢' }).getByRole('radio')
  await expect(options.first()).toContainText('おすすめ')
  const labels = await options.allInnerTexts()
  expect(labels.some((t) => t.includes('最低 40件'))).toBe(true)
  expect(labels.some((t) => t.includes('本命 50件'))).toBe(true)
  expect(labels.some((t) => t.includes('クエストを気にしない'))).toBe(true)
  // 最低 40件を選ぶと、帯の下の作戦も変わる
  const lowest = options.filter({ hasText: '最低 40件' })
  await lowest.click()
  await expect(lowest).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('group', { name: '作戦の日ごとの時間' })).toContainText('最低 40件')
  await expect(page.getByRole('group', { name: '作戦の日ごとの時間' })).toContainText('クエスト')
})
