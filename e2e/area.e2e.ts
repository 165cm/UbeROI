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
