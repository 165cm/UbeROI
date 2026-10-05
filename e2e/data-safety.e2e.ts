// 仕様 07「データ消失・二重取込・外部障害」：A19・A20・A21・A24 を画面から確かめる
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

test('A21：稼働中に再読み込みしても、オフラインでも、記録とタイマーが残る', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-04T18:00:00+09:00') })
  await page.goto('#home')
  await page.getByRole('button', { name: '🏠 自宅を出発' }).click()
  await page.getByRole('button', { name: '🚲 レンタル開始' }).click()
  // アプリ本体が端末に保存される（Service Worker）のを待つ
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.clock.fastForward('45:00')
  await page.reload()
  await expect(page.getByRole('heading', { name: /稼働中/ })).toBeVisible()
  await expect(page.locator('dd', { hasText: '45分' }).first()).toBeVisible()

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: /稼働中/ })).toBeVisible()
  await expect(page.getByText(/オフライン/).first()).toBeVisible()
  await page.getByRole('button', { name: '🏁 帰宅して精算' }).click()
  await page.getByLabel('基本報酬（配送料の合計）').fill('1500')
  await page.getByRole('button', { name: '✅ 確定して保存' }).click()
  await expect(page.locator('.list-item').first()).toContainText('確定')
  await context.setOffline(false)
})

/** 選ぶファイルの置き場所。テスト名（日本語）の入ったフォルダーだと、ファイル選択に渡せないことがあるため別に作る */
async function tempFile(name: string): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'deli-kan-e2e-')), name)
}

const CSV = [
  'external_id,departed_at,returned_at,online_minutes,completed_count,base_yen,tips_yen,bonus_yen,rental_yen,direct_expense_yen,area_label',
  'e2e-1,2026-10-01T18:00:00+09:00,2026-10-01T21:00:00+09:00,150,10,6600,180,400,1760,200,サンプルエリア',
  'e2e-2,2026-10-02T11:00:00+09:00,2026-10-02T14:00:00+09:00,160,8,5200,0,0,0,0,',
].join('\r\n')

test('A19：同じCSVを2回取り込んでも二重にならず、途中に不正な行があれば1件も保存しない', async ({ page }) => {
  const good = await tempFile('good.csv')
  const bad = await tempFile('bad.csv')
  await writeFile(good, CSV)
  await writeFile(bad, CSV.replace(',5200,', ',"5,200",').replace('e2e-', 'bad-'))

  await page.goto('#settings')
  await page.getByRole('tab', { name: 'データ' }).click()
  const card = page.locator('section', { hasText: '📥 CSVから記録を取り込む' })
  const file = card.getByLabel('CSVファイル（.csv）')

  await file.setInputFiles(bad)
  await expect(card.getByRole('alert')).toContainText('3行目')
  await expect(card.getByRole('button', { name: /件を取り込む/ })).toHaveCount(0)

  await file.setInputFiles(good)
  await card.getByRole('button', { name: '📥 2件を取り込む' }).click()
  await expect(card.getByText('✅ 2件を取り込みました')).toBeVisible()
  await file.setInputFiles(good)
  await expect(card.getByText('すべて取込済みです')).toBeVisible()
  await expect(card.getByRole('button', { name: /件を取り込む/ })).toHaveCount(0)

  await page.goto('#records')
  await expect(page.locator('.list-item')).toHaveCount(2)
})

test('A24：デモに切り替えても、合成データが自分の実績に混ざらない', async ({ page }) => {
  await page.goto('#records')
  await page.getByRole('button', { name: /過去の稼働をまとめて入力/ }).click()
  await page.getByLabel('出発（自宅を出た時刻）').fill('2026-10-01T18:00')
  await page.getByLabel('帰宅').fill('2026-10-01T20:00')
  await page.getByLabel('基本報酬（配送料の合計）').fill('3000')
  await page.getByRole('button', { name: '✅ 確定して保存' }).click()
  await expect(page.locator('.list-item')).toHaveCount(1)

  await page.goto('#settings')
  await page.getByRole('tab', { name: 'データ' }).click()
  await page.getByRole('radio', { name: '🧪 デモ' }).click()
  await page.goto('#records')
  await expect(page.getByText('デモ表示中')).toBeVisible()
  expect(await page.locator('.list-item').count()).toBeGreaterThan(1)

  await page.goto('#settings')
  await page.getByRole('tab', { name: 'データ' }).click()
  await page.getByRole('radio', { name: '📒 自分の実績' }).click()
  await page.goto('#records')
  await expect(page.getByText('デモ表示中')).toHaveCount(0)
  await expect(page.locator('.list-item')).toHaveCount(1)
  await expect(page.locator('.list-item').first()).toContainText('3,000円')
})

test('A20：対応していない版のバックアップは復元せず、今のデータはそのまま', async ({ page }) => {
  await page.goto('#records')
  await page.getByRole('button', { name: /過去の稼働をまとめて入力/ }).click()
  await page.getByLabel('出発（自宅を出た時刻）').fill('2026-10-01T18:00')
  await page.getByLabel('帰宅').fill('2026-10-01T20:00')
  await page.getByLabel('基本報酬（配送料の合計）').fill('3000')
  await page.getByRole('button', { name: '✅ 確定して保存' }).click()

  await page.goto('#settings')
  await page.getByRole('tab', { name: 'データ' }).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '⬇️ バックアップを書き出す' }).click()
  const backup = JSON.parse(await readFile(await (await downloading).path(), 'utf8'))
  const future = await tempFile('future.json')
  await writeFile(future, JSON.stringify({ ...backup, schema_version: 99, datasets: { ...backup.datasets, sessions: [] } }))

  await page.getByLabel('バックアップのファイル（.json）').setInputFiles(future)
  await expect(page.getByRole('alert')).toContainText('データの版（99）')
  await expect(page.getByRole('button', { name: '♻️ この内容で置き換える' })).toHaveCount(0)
  await page.goto('#records')
  await expect(page.locator('.list-item')).toHaveCount(1)
})

test('A28：バックアップのファイルを作れなかった時は、成功と表示せず、もう一度試せる', async ({ page }) => {
  // ファイルを作る処理を1回だけ失敗させる（端末の容量不足などの代わり）
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL)
    let failed = false
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (!failed) {
        failed = true
        throw new DOMException('quota', 'QuotaExceededError')
      }
      return original(obj)
    }
  })
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'データ' }).click()
  await page.getByRole('button', { name: '⬇️ バックアップを書き出す' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByText('ファイルを作りました')).toHaveCount(0)
  await expect(page.getByText('最後のバックアップ：まだありません')).toBeVisible()

  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '⬇️ バックアップを書き出す' }).click()
  await downloading
  await expect(page.getByText('ファイルを作りました')).toBeVisible()
  await expect(page.getByText('最後のバックアップ：まだありません')).toHaveCount(0)
})
