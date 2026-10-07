// 🏆 リーダーボード：順位と件数（名前なし）を日跨ぎのクエストに入れると、上との差・攻める目標が出て、計画の作戦に「攻める」が出る
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('順位と件数・賞金を入れると、上との差と攻める目標が出て、計画に「攻める」の選択肢が出る', async ({ page }) => {
  // 土曜 16時（金4:00〜月4:00 の期間のちょうど半分）
  await page.clock.install({ time: new Date('2026-10-10T16:00:00+09:00') })
  await page.goto('#settings')
  await page.getByLabel('週に使える時間', { exact: true }).fill('30')
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

  await page.getByRole('button', { name: '日跨ぎのリーダーボードを入れる' }).click()
  const form = page.getByRole('form', { name: '日跨ぎのリーダーボード' })
  await form.getByLabel('自分の順位', { exact: true }).fill('9')
  await form.getByLabel('自分の件数', { exact: true }).fill('23')
  for (const [rank, count] of <[string, string][]>[['4', '27'], ['5', '25'], ['8', '24']]) {
    await form.getByRole('button', { name: '＋ 順位を追加' }).click()
    const n = await form.getByLabel(/行目の順位$/).count()
    await form.getByLabel(`${n}行目の順位`, { exact: true }).fill(rank)
    await form.getByLabel('件数', { exact: true }).nth(n - 1).fill(count)
  }
  await form.getByRole('button', { name: '＋ 賞金を追加' }).click()
  await form.getByLabel('賞金1：何位まで', { exact: true }).fill('5')
  await form.getByLabel('賞金', { exact: true }).fill('1000')
  // 入力の画面も読み上げ・コントラストの基準を満たす
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations.map((v) => v.id)).toEqual([])
  await form.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText('🏆 リーダーボードを保存しました')).toBeVisible()

  const board = page.getByRole('group', { name: 'リーダーボード' })
  await expect(board).toContainText('9位・23件')
  await expect(board).toContainText('上との差：8位 あと1件・5位 あと2件・4位 あと4件')
  // 賞金のある一番下の5位（今25件 → 期間の半分なので終了で約50件）を上回る51件
  await expect(board).toContainText('攻める：5位なら終了までに51件（あと28件）・賞金1,000円')

  // 読み直しても残る
  await page.reload()
  await expect(board).toContainText('9位・23件')

  await page.goto('#plan')
  const options = page.getByRole('radiogroup', { name: '作戦の選択肢' }).getByRole('radio')
  const attack = options.filter({ hasText: '攻める 5位 51件' })
  await expect(attack).toHaveCount(1)
  await expect(attack).toContainText('🏆届けば+1,000円')
})
