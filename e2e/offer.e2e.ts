// オファー判定（手入力）：最初はオフ。設定でオンにすると、報酬・分・km・届け先の地名を手で入れて判定し、記録できる。
// 配達アプリの画面のスクリーンショットや画面の読み取りは使わない
import { expect, test, type Page } from '@playwright/test'

/** 設定 → 基本で、目標の時給（任意）と帰宅締切（任意）を入れ、オファー判定をオンにする */
async function enableOffer(page: Page, { target, deadline }: { target?: string; deadline?: string } = {}) {
  await page.goto('#settings')
  if (target) await page.getByLabel('目標の営業純時給', { exact: true }).fill(target)
  if (deadline) await page.getByLabel('帰宅締切（任意）').fill(deadline)
  await page.getByLabel('オファー判定を使う（手入力）').check()
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.getByText('使う（手入力）')).toBeVisible()
}

async function addArea(page: Page) {
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'エリア' }).click()
  await page.getByRole('button', { name: 'エリアを追加' }).click()
  await page.getByLabel('エリアの名前', { exact: true }).fill('中野・荻窪エリア')
  const h21 = page.getByRole('button', { name: /^月曜 21時/ })
  for (let i = 0; i < 4; i++) await h21.click()
  await page.getByLabel('このエリアに入る地名（任意）').fill('高円寺、阿佐谷')
  await page.getByRole('button', { name: '💾 保存' }).click()
  await expect(page.locator('.tag', { hasText: '主なエリア' })).toBeVisible()
}

async function enter(page: Page, pay: string, minutes: string, km: string, town = '') {
  await page.getByLabel('報酬', { exact: true }).fill(pay)
  await page.getByLabel('分', { exact: true }).fill(minutes)
  await page.getByLabel('距離', { exact: true }).fill(km)
  await page.getByLabel('届け先の地名（任意）', { exact: true }).fill(town)
}

test('最初はオフ。オンにすると、手で入れた報酬・分・km と届け先の地名から判定して記録できる', async ({ page }) => {
  // 月曜 21:00（日本時間）
  await page.clock.install({ time: new Date('2026-10-05T21:00:00+09:00') })
  await page.goto('#home')
  await expect(page.getByRole('link', { name: '🧾 オファー判定' })).toHaveCount(0)
  await page.goto('#offer')
  await expect(page.getByRole('heading', { name: '🧾 オファー判定はオフです' })).toBeVisible()

  await enableOffer(page, { target: '1500' })
  await addArea(page)
  await page.goto('#home')
  await page.getByRole('link', { name: '🧾 オファー判定' }).click()
  await expect(page.getByText(/スクリーンショットや画面の読み取りは使わないでください/)).toBeVisible()
  await enter(page, '1200', '24', '3.7', '高円寺')
  // レンタル代（HELLO：15分160円 → 余裕5分を足した29分で309円）を引いて (1200 − 309) ÷ 29分 × 60 = 1,843円/時
  const status = page.getByRole('status').filter({ hasText: '受ける' })
  await expect(status).toContainText('✅ 受ける')
  await expect(status).toContainText('1,843円/時')
  await expect(page.getByText('中野・荻窪エリア：段階4 混む')).toBeVisible()
  // 混む届け先なので基準を10%下げる（1,500 → 1,350円）
  await expect(page.getByText('1,350円/時')).toBeVisible()
  await page.getByRole('button', { name: '✅ 受けた' }).click()
  await expect(page.getByText('「受けた」と記録しました')).toBeVisible()
  // ショートカットの作り方の案内は出さない
  await expect(page.getByText('📲 iPhone のショートカットで使う')).toHaveCount(0)
})

test('締切を過ぎる案件は断る。報酬と分がなければ判定しない', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T21:50:00+09:00') })
  await enableOffer(page, { target: '1500', deadline: '22:00' })
  await page.goto('#offer')
  await expect(page.getByText('報酬と分を入れると判定します')).toBeVisible()
  await page.getByLabel('報酬', { exact: true }).fill('2000')
  await page.getByLabel('分', { exact: true }).fill('20')
  await expect(page.getByRole('status').filter({ hasText: '断る' })).toContainText('❌ 断る')
  await expect(page.getByText(/帰宅締切（22:00）を過ぎます/)).toBeVisible()
})

test('前のショートカットの URL で開いても、文字は URL から消える', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T12:00:00+09:00') })
  await enableOffer(page)
  await page.goto(`#offer?text=${encodeURIComponent('¥900 合計 20 分 (2.0 km) 高円寺北2丁目')}`)
  await expect(page.getByLabel('報酬', { exact: true })).toHaveValue('900')
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#offer')
})

test('手入力で記録した地名から、地名の評価（次のオファーまでの待ち時間）を集める', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-05T18:00:00+09:00') })
  await enableOffer(page)
  await addArea(page)
  // 18:00 高円寺 20分 → 18:20 に終わり、18:26 に次 → 待ち6分
  await page.goto('#offer')
  await enter(page, '900', '20', '2.0', '高円寺')
  await page.getByRole('button', { name: '✅ 受けた' }).click()
  await expect(page.getByText('「受けた」と記録しました')).toBeVisible()
  await page.clock.setFixedTime(new Date('2026-10-05T18:26:00+09:00'))
  await page.goto('#home')
  await page.goto('#offer')
  await enter(page, '400', '15', '3.0')
  await page.getByRole('button', { name: '❌ 断った' }).click()
  await expect(page.getByText('「断った」と記録しました')).toBeVisible()
  await page.getByText('🧠 地名の評価（記録から学習）', { exact: true }).click()
  await expect(page.getByText('判定に使用 0／1')).toBeVisible()
  const row = page.getByRole('region', { name: '地名の評価の一覧' }).getByRole('row', { name: /高円寺/ })
  await expect(row).toContainText('夕方')
  await expect(row).toContainText('6分')
})
