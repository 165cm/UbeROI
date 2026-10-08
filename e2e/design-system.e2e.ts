import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('Demoの共通スタイル：昼夜の主要画面と設定全項目を操作できる', async ({ page }, info) => {
  test.setTimeout(60_000)
  await page.clock.install({ time: new Date('2026-10-07T18:00:00+09:00') })
  await page.goto('#home')
  await page.getByRole('button', { name: 'クエストを追加' }).click()
  await page.getByLabel('名前', { exact: true }).fill('日跨ぎ')
  await page.getByLabel('開始', { exact: true }).fill('2026-10-05T04:00')
  await page.getByLabel('終了', { exact: true }).fill('2026-10-09T04:00')
  await page.getByLabel('第1段階の件数', { exact: true }).fill('50')
  await page.getByLabel('報酬', { exact: true }).fill('1170')
  await page.getByLabel('件数の調整（±）', { exact: true }).fill('47')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await page.getByRole('button', { name: '自宅を出発' }).click()
  await page.getByRole('button', { name: 'レンタル開始' }).click()
  await page.clock.fastForward('02:18:00')
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await page.screenshot({ path: info.outputPath(`home-${colorScheme}.png`), fullPage: true })
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([])
  }
  await page.clock.fastForward('00:42:00')
  await page.getByRole('button', { name: '帰宅して精算' }).click()
  await page.getByLabel('基本報酬', { exact: true }).fill('6800')
  await page.getByLabel('チップ', { exact: true }).fill('380')
  await page.getByLabel('レンタル実請求', { exact: true }).fill('1760')
  await page.getByRole('button', { name: '経費を追加' }).click()
  await page.getByLabel('金額', { exact: true }).fill('200')
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await page.screenshot({ path: info.outputPath(`settlement-${colorScheme}.png`), fullPage: true })
  }
  await page.getByRole('button', { name: '精算を保存', exact: true }).click()
  await page.getByRole('link', { name: '計画', exact: true }).click()
  const setup = page.getByRole('form', { name: '計画の初期設定' })
  await setup.getByLabel('計画に使う週の時間', { exact: true }).fill('12')
  await setup.getByLabel('計画の目標時給', { exact: true }).fill('1000')
  await setup.getByLabel('利用する自転車・料金', { exact: true }).selectOption({ label: '自分の自転車・月額サブスク' })
  await setup.getByLabel('働ける時間帯', { exact: true }).selectOption('side-night')
  await setup.getByRole('button', { name: '条件を保存して提案を見る' }).click()
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    for (const screen of ['計画', '記録', '分析', '設定']) {
      await page.getByRole('link', { name: screen, exact: true }).click()
      await page.screenshot({ path: info.outputPath(`${screen}-${colorScheme}.png`), fullPage: true })
      for (const width of [320, 390, 844, 1280]) {
        await page.setViewportSize({ width, height: width === 844 ? 390 : 844 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
      }
      await page.setViewportSize({ width: 390, height: 844 })
    }
    for (const name of ['基本', '料金', '装備と投資', '固定費', 'エリア', 'データ']) {
      await page.getByRole('tab', { name, exact: true }).click()
      await page.screenshot({ path: info.outputPath(`settings-${name}-${colorScheme}.png`), fullPage: true })
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      expect(axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([])
    }
  }
})
