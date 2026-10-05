// 受入 A23：画面幅320/390、文字200%、キーボード操作で、主な操作とエラーの説明に届く
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const TABS = ['home', 'records', 'analytics', 'plan', 'offer', 'settings'] as const
const SETTINGS_SECTIONS = ['基本', '料金', '装備と投資', '固定費', 'エリア', 'データ'] as const

/** デモのデータ（合成）を入れて、グラフや一覧がある状態で確かめる */
async function useDemo(page: Page) {
  await page.goto('#settings')
  await page.getByRole('tab', { name: 'データ' }).click()
  await page.getByRole('radio', { name: '🧪 デモ' }).click()
  await expect(page.getByText('デモ表示中')).toBeVisible()
}

/** 画面ごと（設定は項目ごと）に fn を呼ぶ */
async function eachScreen(page: Page, fn: (name: string) => Promise<void>) {
  for (const tab of TABS) {
    await page.goto(`#${tab}`)
    await expect(page.locator('main')).toBeVisible()
    if (tab !== 'settings') {
      await fn(tab)
      continue
    }
    for (const section of SETTINGS_SECTIONS) {
      await page.getByRole('tab', { name: section }).click()
      await fn(`settings/${section}`)
    }
  }
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

test('読み上げ・コントラストなどの自動チェック（axe）で、重大な問題がない', async ({ page }) => {
  await useDemo(page)
  const found: string[] = []
  await eachScreen(page, async (name) => {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    for (const v of result.violations) {
      if (v.impact === 'serious' || v.impact === 'critical') found.push(`${name}: ${v.id}（${v.nodes.length}か所）${v.nodes[0]?.target.join(' ')}`)
    }
  })
  expect(found).toEqual([])
})

test('暗い表示でも、文字の色の差（コントラスト）が足りている', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await useDemo(page)
  const found: string[] = []
  await eachScreen(page, async (name) => {
    const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
    for (const v of result.violations) found.push(`${name}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  })
  expect(found).toEqual([])
})

for (const width of [320, 390, 1280]) {
  test(`幅${width}pxで、どの画面も横にはみ出さない`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await useDemo(page)
    const found: string[] = []
    await eachScreen(page, async (name) => {
      const over = await horizontalOverflow(page)
      if (over > 0) found.push(`${name}: ${over}px`)
    })
    expect(found).toEqual([])
  })
}

test('文字を200%にしても、横にはみ出さず、下のメニューと主なボタンが押せる', async ({ page }) => {
  await useDemo(page)
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' })
  const found: string[] = []
  await eachScreen(page, async (name) => {
    const over = await horizontalOverflow(page)
    if (over > 0) found.push(`${name}: ${over}px`)
  })
  expect(found).toEqual([])
  // 下のメニューで全画面へ行ける
  for (const name of ['記録', '分析', '計画', '設定', 'ホーム']) {
    await page.getByRole('link', { name: new RegExp(name) }).click()
    await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveAttribute('aria-current', 'page')
  }
})

/** Tab キーで、名前が name のボタン・リンクまで進む（最大 80 回） */
async function tabTo(page: Page, name: RegExp): Promise<void> {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab')
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      // 何も選ばれていない時（body）は、ページ全体の文字になるので数えない
      if (!el || el === document.body) return ''
      return (el.getAttribute('aria-label') ?? el.innerText ?? '').trim()
    })
    if (name.test(label)) return
  }
  throw new Error(`Tab キーで ${name} に届きません`)
}

test('キーボードだけで、出発 → 帰宅 → 精算の入力 → 保存ができ、入力の誤りも読み上げられる', async ({ page }) => {
  await page.goto('#home')
  await tabTo(page, /自宅を出発/)
  // 押せる場所にいることが見える（フォーカスの枠）
  await expect(page.locator(':focus')).toHaveCSS('outline-style', 'solid')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: /稼働中/ })).toBeVisible()
  await tabTo(page, /帰宅して精算/)
  await page.keyboard.press('Enter')

  // 精算画面：入力欄へ Tab で進み、文字で入れる。誤り（小数）は説明が出て、欄が「誤り」と伝わる
  await expect(page.getByLabel('基本報酬（配送料の合計）', { exact: true })).toBeVisible()
  await page.getByLabel('基本報酬（配送料の合計）', { exact: true }).focus()
  await page.keyboard.type('12.5')
  const base = page.getByLabel('基本報酬（配送料の合計）', { exact: true })
  await expect(base).toHaveAttribute('aria-invalid', 'true')
  await expect(base).toHaveAccessibleDescription(/0以上の整数/)
  await page.keyboard.press('Control+A')
  await page.keyboard.type('3000')
  await expect(base).not.toHaveAttribute('aria-invalid', 'true')
  await tabTo(page, /確定して保存/)
  await page.keyboard.press('Enter')
  await expect(page.locator('.list-item').first()).toContainText('確定')
})

test('保存できない時の説明は、読み上げソフトに伝わる（role=alert）', async ({ page }) => {
  await page.goto('#records')
  await page.getByRole('button', { name: /過去の稼働をまとめて入力/ }).click()
  await page.getByLabel('出発（自宅を出た時刻）', { exact: true }).fill('2026-10-05T18:00')
  await page.getByLabel('帰宅', { exact: true }).fill('2026-10-05T17:00')
  await page.getByLabel('基本報酬（配送料の合計）', { exact: true }).fill('1000')
  await page.getByRole('button', { name: '✅ 確定して保存' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '帰宅は出発より後にしてください' })).toBeVisible()
  // 保存されていない（一覧に戻らず、記録も増えない）
  await page.goto('#records')
  await expect(page.locator('.list-item')).toHaveCount(0)
})
