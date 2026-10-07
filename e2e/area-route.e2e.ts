// 計画：時間帯ごとのエリア計画。候補枠の時間に、混み具合・移動の分から、どの時間にどのエリアにいるとよいかの順番を出す
import { expect, test, type Page } from '@playwright/test'

async function setLevel(page: Page, hour: number, clicks: number) {
  const cell = page.getByRole('button', { name: new RegExp(`^月曜 ${hour}時`) })
  for (let i = 0; i < clicks; i++) await cell.click()
}

test('混む時間に合わせて、主なエリアから隣のエリアへ移る順番と、ずっといる場合との差が出る', async ({ page }) => {
  // 月曜の昼
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+09:00') })
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'エリア' }).click()
  // 主なエリア：月曜17・18時台は混む（段階4）、19・20時台は空き（段階1）
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('中野エリア')
  for (const h of [17, 18]) await setLevel(page, h, 4)
  for (const h of [19, 20]) await setLevel(page, h, 1)
  await page.getByRole('button', { name: '💾 保存' }).click()

  // 移動の分のエリアがまだない時は、入れ方を案内する
  await page.goto('#plan')
  await page.getByRole('tab', { name: '予定' }).click()
  await page.getByRole('button', { name: '候補枠を追加' }).click()
  await page.getByLabel('出発', { exact: true }).fill('17:00')
  await page.getByLabel('帰宅', { exact: true }).fill('21:00')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await page.getByText('📋 くわしく見る').click()
  const card = page.getByRole('region', { name: '🧭 時間帯ごとのエリア計画' })
  await expect(card).toContainText('ほかのエリアに「中野エリア」からの移動の分を入れると')

  // 隣のエリア：月曜17・18時台は空き、19・20時台は混む。移動15分
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'エリア' }).click()
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('新宿エリア')
  for (const h of [17, 18]) await setLevel(page, h, 1)
  for (const h of [19, 20]) await setLevel(page, h, 4)
  await page.getByLabel('主なエリアにする（計画と「続ける？帰る？」の見込みに使う）').uncheck()
  await page.getByLabel('主なエリアからの移動（任意）', { exact: true }).fill('15')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText(/移動15分/)).toBeVisible()

  await page.goto('#plan')
  await page.getByRole('tab', { name: '予定' }).click()
  await page.getByText('📋 くわしく見る').click()
  await expect(card.getByRole('combobox', { name: 'どの候補枠で見るか' })).toHaveValue(/.+/)
  const steps = card.getByRole('list', { name: 'エリアの順番' }).getByRole('listitem')
  await expect(steps).toHaveCount(2)
  // 目安 1,400円/時 × 段階4（×1.35）× 2時間 = 3,780円
  await expect(steps.nth(0)).toContainText('17:00〜19:00 中野エリア（主なエリア）3,780円')
  await expect(steps.nth(0)).toContainText('混み具合 17時 4・18時 4')
  // 19:15 に着く：1,400 × 1.35 × (0.75 + 1) = 3,308円
  await expect(steps.nth(1)).toContainText('🚲 新宿エリアへ移動（15分の目安）')
  await expect(steps.nth(1)).toContainText('19:15〜21:00 新宿エリア3,308円')
  // ずっと中野：3,780 + 1,400 × 0.6 × 2 = 5,460円 → 差 1,628円
  await expect(card.getByRole('status')).toHaveText('👉 ずっと「中野エリア」にいるより +1,628円 の見込み（移動1回。合計 7,088円）')
})
