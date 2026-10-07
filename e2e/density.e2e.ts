// 情報密度の工夫（docs/UI_RULES.md「4. 情報密度」）：ⓘ の説明、設定済みを1行に畳む
import { expect, test } from '@playwright/test'

test('ⓘ を押すと説明が開き、もう一度押すと閉じる。閉じていても入力欄の説明として読み上げられる', async ({ page }) => {
  await page.goto('#records')
  await page.getByRole('button', { name: /過去の稼働をまとめて入力/ }).click()
  const tip = page.getByRole('button', { name: '帰宅の説明' })
  await expect(tip).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('空欄なら下書き')).toBeHidden()
  await expect(page.getByLabel('帰宅', { exact: true })).toHaveAccessibleDescription(/空欄なら下書き/)
  await tip.click()
  await expect(page.getByText('空欄なら下書き')).toBeVisible()
  await tip.click()
  await expect(page.getByText('空欄なら下書き')).toBeHidden()
})

test('基本設定は保存すると1行の要約に畳まれ、✏️ で開ける', async ({ page }) => {
  await page.goto('#settings')
  await page.getByLabel('目標の営業純時給', { exact: true }).fill('1500')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByLabel('目標の営業純時給', { exact: true })).toHaveCount(0)
  await expect(page.getByText('1,500円/時')).toBeVisible()
  await page.getByRole('button', { name: '基本設定を編集' }).click()
  await expect(page.getByLabel('目標の営業純時給', { exact: true })).toHaveValue('1500')
})

test('装備の品目は畳まれていて、新しく足した品目は名前を入れても畳まれない', async ({ page }) => {
  await page.goto('#settings')
  await page.getByRole('tab', { name: '装備と投資' }).click()
  await expect(page.getByLabel('価格（税込・1個）', { exact: true }).first()).toBeHidden()
  await page.getByRole('button', { name: '＋ 明細' }).click()
  const name = page.getByLabel('品目', { exact: true }).last()
  await name.fill('サドルカバー')
  await expect(name).toBeVisible()
  await expect(page.getByLabel('価格（税込・1個）', { exact: true }).last()).toBeVisible()
})

test('空の記録で「件数・天気・メモを追加」を開いて入力しても、畳まれない', async ({ page }) => {
  await page.goto('#records')
  await page.getByRole('button', { name: /過去の稼働をまとめて入力/ }).click()
  await page.getByText('📝 件数・天気・メモを追加').click()
  const area = page.getByLabel('エリア（任意）', { exact: true })
  await area.pressSequentially('駅前')
  await page.getByLabel('メモ（任意）', { exact: true }).pressSequentially('雨上がり')
  await expect(area).toBeVisible()
  await expect(area).toHaveValue('駅前')
})

test('設定の項目のタブは、幅320pxでも横にスクロールせずに全部見える', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('#settings')
  const list = page.getByRole('tablist', { name: '設定の項目' })
  expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0)
  for (const tab of await list.getByRole('tab').all()) await expect(tab).toBeInViewport({ ratio: 1 })
})
