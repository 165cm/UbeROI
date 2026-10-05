// オファー判定：ショートカットが読み取った文字（text=）から判定し、記録する。
// 設定コード（cfg=）付きの URL は、保存場所が別のブラウザー（iPhone の Safari と同じ状況）でも同じ判定になる
import { expect, test } from '@playwright/test'

const OCR = '配達 (2) 限定\n¥1,200\nUber 技術サービス契約が適用されます\n合計 24 分 (3.7 km)\n高円寺北2丁目\n承諾'

test('読み取った文字から実質時給を出し、届け先の混み具合で判定して記録できる。設定コードで別のブラウザーでも同じ判定', async ({ page, browser }) => {
  // 月曜 21:00（日本時間）
  await page.clock.install({ time: new Date('2026-10-05T21:00:00+09:00') })
  await page.goto('#settings')
  await page.getByLabel('目標の営業純時給', { exact: true }).fill('1500')
  await page.getByRole('button', { name: '💾 保存' }).click()
  // エリア：月曜21時台は「混む」、地名に高円寺
  await page.getByRole('tab', { name: 'エリア' }).click()
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('中野・荻窪エリア')
  const h21 = page.getByRole('button', { name: /^月曜 21時/ })
  for (let i = 0; i < 4; i++) await h21.click()
  await page.getByLabel('このエリアに入る地名（任意）').fill('高円寺、阿佐谷')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.locator('.tag', { hasText: '主なエリア' })).toBeVisible()

  // ショートカットと同じ形の URL で開く
  await page.goto(`#offer?text=${encodeURIComponent(OCR)}`)
  await expect(page.getByLabel('報酬', { exact: true })).toHaveValue('1200')
  await expect(page.getByLabel('分', { exact: true })).toHaveValue('24')
  // レンタル代（HELLO：15分160円 → 余裕5分を足した29分で309円）を引いて (1200 − 309) ÷ 29分 × 60 = 1,843円/時
  const status = page.getByRole('status').filter({ hasText: '受ける' })
  await expect(status).toContainText('✅ 受ける')
  await expect(status).toContainText('1,843円/時')
  await expect(page.getByText('中野・荻窪エリア：段階4 混む')).toBeVisible()
  // 混む届け先なので基準を10%下げる（1,500 → 1,350円）
  await expect(page.getByText('1,350円/時')).toBeVisible()

  await page.getByRole('button', { name: '✅ 受けた' }).click()
  await expect(page.getByText('「受けた」と記録しました')).toBeVisible()

  // ショートカットに貼る URL（設定コード入り）を、保存場所が別のブラウザーで開く
  await page.getByText('📲 iPhone のショートカットで使う').click()
  const url = await page.getByLabel('ショートカットに貼る URL', { exact: true }).inputValue()
  expect(url).toMatch(/^https:\/\/165cm\.github\.io\/UbeROI\/#offer\?cfg=[A-Za-z0-9_-]+&text=$/)
  const other = await browser.newContext({ timezoneId: 'Asia/Tokyo', viewport: { width: 390, height: 844 } })
  const safari = await other.newPage()
  await safari.clock.install({ time: new Date('2026-10-05T21:00:00+09:00') })
  await safari.goto(`/UbeROI/${url.slice(url.indexOf('#'))}${encodeURIComponent(OCR)}`)
  await expect(safari.getByText(/設定コード（\d{4}-\d{2}-\d{2} 作成）で判定/)).toBeVisible()
  await expect(safari.getByRole('status').filter({ hasText: '受ける' })).toContainText('1,843円/時')
  await expect(safari.getByText('中野・荻窪エリア：段階4 混む')).toBeVisible()
  await other.close()
})

test('締切を過ぎる案件は断る。報酬と分がなければ判定しない', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T21:50:00+09:00') })
  await page.goto('#settings')
  await page.getByLabel('目標の営業純時給', { exact: true }).fill('1500')
  await page.getByLabel('帰宅締切（任意）').fill('22:00')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await page.goto('#offer')
  await expect(page.getByText('報酬と分を入れると判定します')).toBeVisible()
  await page.getByLabel('報酬', { exact: true }).fill('2000')
  await page.getByLabel('分', { exact: true }).fill('20')
  await expect(page.getByRole('status').filter({ hasText: '断る' })).toContainText('❌ 断る')
  await expect(page.getByText(/帰宅締切（22:00）を過ぎます/)).toBeVisible()
})

test('読み取った文字は URL から消える。続けて別のオファーを開くと、新しい値で判定し直す', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+09:00') })
  await page.goto(`#offer?text=${encodeURIComponent('¥900 合計 20 分 (2.0 km) 高円寺北2丁目')}`)
  await expect(page.getByLabel('報酬', { exact: true })).toHaveValue('900')
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#offer')
  // 同じページのまま、次のオファーを開く（ショートカットを続けて使う時）
  await page.evaluate(() => {
    location.hash = `#offer?text=${encodeURIComponent('¥1,500 合計 30 分 (4.1 km)')}`
  })
  await expect(page.getByLabel('報酬', { exact: true })).toHaveValue('1500')
  await expect(page.getByLabel('分', { exact: true })).toHaveValue('30')
})

test('設定コードの主なエリアは、届け先の地名が見つからない時に別のブラウザーでも使われる', async ({ page, browser }) => {
  await page.clock.install({ time: new Date('2026-10-05T21:00:00+09:00') })
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'エリア' }).click()
  for (const [name, primary] of [['新宿エリア', false], ['中野・荻窪エリア', true]] as const) {
    await page.getByRole('button', { name: 'エリアを追加' }).click()
    await page.getByLabel('エリアの名前', { exact: true }).fill(name)
    const h21 = page.getByRole('button', { name: /^月曜 21時/ })
    for (let i = 0; i < (primary ? 4 : 1); i++) await h21.click()
    const check = page.getByRole('checkbox', { name: /主なエリアにする/ })
    if ((await check.isChecked()) !== primary) await check.click()
    await page.getByRole('button', { name: '💾 保存' }).click()
  }
  await page.goto('#offer')
  await page.getByText('📲 iPhone のショートカットで使う').click()
  const url = await page.getByLabel('ショートカットに貼る URL', { exact: true }).inputValue()
  const other = await browser.newContext({ timezoneId: 'Asia/Tokyo', viewport: { width: 390, height: 844 } })
  const safari = await other.newPage()
  await safari.clock.install({ time: new Date('2026-10-05T21:00:00+09:00') })
  await safari.goto(`/UbeROI/${url.slice(url.indexOf('#'))}${encodeURIComponent('¥1,200 合計 24 分 (3.7 km) 地名なし')}`)
  await expect(safari.getByText('中野・荻窪エリア：段階4 混む')).toBeVisible()
  // 読み取った文字は URL から消え、設定コードだけ残る
  await expect.poll(() => safari.evaluate(() => location.hash)).toMatch(/^#offer\?cfg=[A-Za-z0-9_-]+$/)
  await other.close()
})
