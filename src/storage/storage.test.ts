// 保存・検証・装備と実績の分離（受入 A11〜A13・A18・A22・A24・A28・A30）
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeliKanDB } from './db'
import {
  ValidationError,
  acquirePlanItem,
  arriveHome,
  applyPreset,
  deleteAsset,
  deleteSession,
  deleteArea,
  departNow,
  primaryArea,
  saveArea,
  saveSettings,
  emptySession,
  endRental,
  ensureInitialData,
  restoreSession,
  saveQuest,
  saveRecurringExpense,
  saveSession,
  saveTariff,
  startRental,
} from './repo'
import { EQUIPMENT_PRESETS } from './presets'
import { emptyBusyness, questProgress } from '../domain'
import { errorMessages } from '../components/fields'
import type { SessionRecord } from './schema'
import { periodFor, recoveryFor } from './toDomain'

let db: DeliKanDB
let n = 0

beforeEach(async () => {
  db = new DeliKanDB(`test-${n++}`)
  await ensureInitialData(db)
})

afterEach(async () => {
  await db.delete()
})

function completed(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    ...emptySession('2026-10-04T09:00:00Z', 'completed'),
    returnedAt: '2026-10-04T12:00:00Z',
    baseYen: 6780,
    tipsYen: 0,
    completedCount: 10,
    adjustments: [{ id: 'q1', kind: 'quest', amountYen: 400 }],
    summaryOnlineSeconds: 9000,
    directExpenses: [{ id: 'e1', category: 'consumable', amountYen: 200, memo: '' }],
    ...overrides,
  }
}

const snapshot = async () => ({
  sessions: await db.sessions.toArray(),
  recurringExpenses: await db.recurringExpenses.toArray(),
  assets: await db.assets.toArray(),
})

describe('初期データ', () => {
  it('料金プリセット3つ・空の設定・3プランを1回だけ作る', async () => {
    await ensureInitialData(db)
    expect(await db.tariffs.count()).toBe(3)
    expect(await db.plans.count()).toBe(3)
    const settings = await db.settings.get('settings')
    expect(settings?.originLabel).toBeNull()
    expect(settings?.targetHourlyYen).toBeNull()
  })
})

describe('稼働の記録', () => {
  it('出発 → レンタル → 返却 → 確定で、料金スナップショットから費用が出る', async () => {
    const tariff = (await db.tariffs.toArray()).find((t) => t.tariff.kind === 'tiered')!
    const id = await departNow(db, '2026-10-04T09:00:00Z')
    await startRental(db, id, tariff, '2026-10-04T09:00:00Z')
    const s = (await db.sessions.get(id))!
    await endRental(db, id, s.rentals[0]!.id, '2026-10-04T12:00:00Z')
    const done = (await db.sessions.get(id))!
    await saveSession(db, { ...completed(), id, rentals: done.rentals, createdAt: done.createdAt, revision: done.revision })
    const p = periodFor(await snapshot(), '2026-10-01', '2026-10-31')
    expect(p.totals.operatingProfitYen).toBe(5220)
    expect(p.totals.hourlyYen).toBe(1740)
  })

  it('A22 料金設定を変えても過去の記録はスナップショットのまま', async () => {
    const tariff = (await db.tariffs.toArray()).find((t) => t.tariff.kind === 'tiered')!
    await saveSession(db, completed({ rentals: [{ id: 'r', tariffName: tariff.name, tariff: tariff.tariff, startAt: '2026-10-04T09:00:00Z', endAt: '2026-10-04T12:00:00Z', billedYen: null }] }))
    await saveTariff(db, { ...tariff, tariff: { ...(tariff.tariff as { kind: 'tiered' } & typeof tariff.tariff), initialYen: 999 } as typeof tariff.tariff })
    expect((await db.tariffs.get(tariff.id))?.archived).toBe(true)
    const p = periodFor(await snapshot(), '2026-10-01', '2026-10-31')
    expect(p.totals.rentalYen).toBe(1760)
  })

  it('帰宅＜出発・確定なのに帰宅なし・重なる記録・2件目の稼働中は保存できない', async () => {
    await expect(saveSession(db, completed({ returnedAt: '2026-10-04T08:00:00Z' }))).rejects.toThrow(ValidationError)
    await expect(saveSession(db, completed({ returnedAt: null }))).rejects.toThrow(ValidationError)
    await saveSession(db, completed())
    await expect(saveSession(db, completed({ departedAt: '2026-10-04T11:00:00Z', returnedAt: '2026-10-04T13:00:00Z' }))).rejects.toThrow(
      /重なって/,
    )
    await departNow(db, '2026-10-05T09:00:00Z')
    await expect(departNow(db, '2026-10-06T09:00:00Z')).rejects.toThrow(/稼働中/)
  })

  it('A30 帰宅未入力は下書きとして保存でき、確定集計から外れて件数が出る', async () => {
    await saveSession(db, { ...completed(), status: 'draft', returnedAt: null })
    const p = periodFor(await snapshot(), '2026-10-01', '2026-10-31')
    expect(p.rows).toHaveLength(0)
    expect(p.excludedDrafts).toBe(1)
  })

  it('削除して元に戻すと同じ記録が戻る', async () => {
    const s = completed()
    await saveSession(db, s)
    const deleted = await deleteSession(db, s.id)
    expect(await db.sessions.count()).toBe(0)
    await restoreSession(db, deleted!)
    expect((await db.sessions.get(s.id))?.baseYen).toBe(6780)
  })
})

describe('装備プランと実績（A11〜A13）', () => {
  it('予定の装備を足してもプランを変えても、実績の回収は購入した物だけで決まる', async () => {
    await saveSession(db, completed())
    const [plan] = await db.plans.where('tier').equals('beginner').toArray()
    plan!.items[0]!.unitYen = 30000
    await db.plans.put(plan!)
    await acquirePlanItem(db, plan!.id, plan!.items[0]!.id, { state: 'purchased', purchasedAt: '2026-10-01T03:00:00Z' })
    const before = recoveryFor(await snapshot(), '2026-10-31T00:00:00Z')
    expect(before.remainingYen).toBe(30000 - (7180 - 200))

    const intermediate = (await db.plans.where('tier').equals('intermediate').first())!
    intermediate.items[0]!.unitYen = 50000
    await db.plans.put(intermediate)
    const updated = applyPreset((await db.plans.get(plan!.id))!, EQUIPMENT_PRESETS.advanced.items)
    expect(updated.items.find((i) => i.state === 'purchased')).toBeDefined()
    await db.plans.put(updated)
    expect(recoveryFor(await snapshot(), '2026-10-31T00:00:00Z')).toEqual(before)
  })

  it('A12 前から持っている物は現金投資0、配賦は入力した価値だけ', async () => {
    const plan = (await db.plans.where('tier').equals('beginner').first())!
    await acquirePlanItem(db, plan.id, plan.items[1]!.id, { state: 'owned', managementValueYen: 3600, inServiceMonth: '2026-10' })
    const r = recoveryFor(await snapshot(), '2026-10-31T00:00:00Z')
    expect(r.investedYen).toBe(0)
    const p = periodFor(await snapshot(), '2026-10-01', '2026-10-31')
    expect(p.totals.allocatedInvestmentYen).toBe(100) // 3600円 ÷ 36か月
  })

  it('価格未設定のままでは購入にできない。資産を消すと品目は予定に戻る', async () => {
    const plan = (await db.plans.where('tier').equals('beginner').first())!
    await expect(
      acquirePlanItem(db, plan.id, plan.items[0]!.id, { state: 'purchased', purchasedAt: '2026-10-01T03:00:00Z' }),
    ).rejects.toThrow(/価格/)
    const assetId = await acquirePlanItem(db, plan.id, plan.items[0]!.id, { state: 'owned', managementValueYen: null, inServiceMonth: '2026-10' })
    await deleteAsset(db, assetId)
    expect((await db.plans.get(plan.id))!.items[0]!.state).toBe('planned')
  })
})

describe('固定費（A15）', () => {
  it('稼働のない月も、毎月の固定費は月の損益に残る', async () => {
    await saveRecurringExpense(db, { id: 'phone', label: '通信', category: 'communication', amountYen: 1000, startMonth: '2026-10', endMonth: null })
    const p = periodFor(await snapshot(), '2026-11-01', '2026-11-30')
    expect(p.totals.operatingProfitYen).toBe(-1000)
  })
})

describe('A24 デモと実績の分離', () => {
  it('別のデータベースなので、デモの記録は実績に出ない', async () => {
    const demo = new DeliKanDB(`test-demo-${n++}`)
    await ensureInitialData(demo)
    await saveSession(demo, completed())
    expect(await db.sessions.count()).toBe(0)
    await demo.delete()
  })
})

describe('レビュー指摘', () => {
  it('前から持っている物の利用開始月が空・不正なら登録しない', async () => {
    const plan = (await db.plans.where('tier').equals('beginner').first())!
    for (const month of ['', '2026-13', '2026-1']) {
      await expect(
        acquirePlanItem(db, plan.id, plan.items[0]!.id, { state: 'owned', managementValueYen: 1200, inServiceMonth: month }),
      ).rejects.toThrow(ValidationError)
    }
    expect(await db.assets.count()).toBe(0)
  })

  it('帰宅したら稼働中を終え、精算待ちの下書きにする（レンタルも返却）', async () => {
    const tariff = (await db.tariffs.toArray()).find((t) => t.tariff.kind === 'tiered')!
    const id = await departNow(db, '2026-10-04T09:00:00Z')
    await startRental(db, id, tariff, '2026-10-04T09:05:00Z')
    await arriveHome(db, id, '2026-10-04T12:00:00Z')
    const s = (await db.sessions.get(id))!
    expect(s.status).toBe('draft')
    expect(s.returnedAt).toBe('2026-10-04T12:00:00Z')
    expect(s.rentals[0]!.endAt).toBe('2026-10-04T12:00:00Z')
    // 稼働中が残らないので、次の出発ができる
    await expect(departNow(db, '2026-10-05T09:00:00Z')).resolves.toBeTypeOf('string')
  })
})

describe('クエストの保存の制約（レビュー指摘）', () => {
  const quest = (over: Record<string, unknown> = {}) => ({
    id: 'q',
    label: '選択制',
    platform: 'uber' as const,
    startsAt: '2026-10-04T19:00:00Z',
    endsAt: '2026-10-08T19:00:00Z',
    rewardMode: 'cumulative' as const,
    tiers: [
      { count: 10, rewardYen: 1000 },
      { count: 20, rewardYen: 500 },
    ],
    manualOffset: 0,
    createdAt: '',
    updatedAt: '',
    revision: 0,
    ...over,
  })

  it('累積の報酬が前の段階より減る入力は保存しない（上乗せの書き方なら可）', async () => {
    await expect(saveQuest(db, quest())).rejects.toThrow(/累積/)
    await expect(saveQuest(db, quest({ rewardMode: 'incremental' }))).resolves.toBeUndefined()
  })
})

describe('A18 クエストの見込みは実績に入れない', () => {
  it('達成見込み1,000円のクエストがあっても、実績の売上は確定した5,000円のまま', async () => {
    await saveSession(db, completed({ baseYen: 5000, adjustments: [], directExpenses: [] }))
    await saveQuest(db, {
      id: 'q-ev',
      label: '選択制',
      platform: 'uber',
      startsAt: '2026-10-01T00:00:00Z',
      endsAt: '2026-10-08T00:00:00Z',
      rewardMode: 'incremental',
      tiers: [{ count: 10, rewardYen: 1000 }],
      manualOffset: 0,
      createdAt: '',
      updatedAt: '',
      revision: 0,
    })
    const quests = await db.quests.toArray()
    const sessions = await db.sessions.toArray()
    const progress = questProgress(quests[0]!, sessions.map((s) => ({ status: s.status, returnedAt: s.returnedAt, completedCount: s.completedCount, eligible: true })), '2026-10-05T00:00:00Z')
    expect(progress.earnedYen).toBe(1000)
    expect(periodFor(await snapshot(), '2026-10-04', '2026-10-04').totals.revenueYen).toBe(5000)
  })
})

describe('A28 保存容量が足りない時', () => {
  it('成功とは言わず、バックアップの書き出しと再試行を案内する', () => {
    const quota = Object.assign(new Error('quota'), { name: 'AbortError', inner: { name: 'QuotaExceededError' } })
    expect(errorMessages(quota)).toEqual([expect.stringMatching(/保存容量が足りない.*バックアップを書き出し.*もう一度/)])
  })
})

describe('エリアの混み具合', () => {
  const area = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    name: ' 中野・荻窪エリア ',
    levels: emptyBusyness(),
    towns: [' 高円寺', '阿佐谷', '高円寺 '],
    checkedAt: '2026-10-05',
    createdAt: '',
    updatedAt: '',
    revision: 0,
    ...over,
  })

  it('名前と地名の空白を除き、重なった地名を1つにして保存する。名前が空なら保存しない', async () => {
    await saveArea(db, area())
    expect(await db.areas.get('a1')).toMatchObject({ name: '中野・荻窪エリア', towns: ['高円寺', '阿佐谷'] })
    await expect(saveArea(db, area({ id: 'a2', name: ' ' }))).rejects.toBeInstanceOf(ValidationError)
  })

  it('主なエリアの指定は、エリアの保存と同じ1回の書き込みで変わる。外すと指定も消える', async () => {
    await saveArea(db, area({ id: 'a3', name: '荻窪' }), true)
    expect((await db.settings.get('settings'))?.primaryAreaId).toBe('a3')
    await saveArea(db, area({ id: 'a3', name: '荻窪' }), false)
    expect((await db.settings.get('settings'))?.primaryAreaId).toBeNull()
    // 名前が空なら、主なエリアの指定も変わらない
    await expect(saveArea(db, area({ id: 'a4', name: '' }), true)).rejects.toBeInstanceOf(ValidationError)
    expect((await db.settings.get('settings'))?.primaryAreaId).toBeNull()
  })

  it('確かめた日が実在しない日付（2月30日など）なら保存しない', async () => {
    await expect(saveArea(db, area({ checkedAt: '2026-02-30' }))).rejects.toThrow(/実在する日付/)
    await expect(saveArea(db, area({ checkedAt: '2026-99-99' }))).rejects.toThrow(/実在する日付/)
  })

  it('主なエリア：指定したものを使い、指定がなく1つだけならそれを使う。消すと指定も外れる', async () => {
    await saveArea(db, area())
    expect(primaryArea(await db.areas.toArray(), await db.settings.get('settings'))?.id).toBe('a1')
    await saveArea(db, area({ id: 'a2', name: '新宿' }))
    expect(primaryArea(await db.areas.toArray(), await db.settings.get('settings'))).toBeUndefined()
    await saveSettings(db, { primaryAreaId: 'a2' })
    expect(primaryArea(await db.areas.toArray(), await db.settings.get('settings'))?.id).toBe('a2')
    await deleteArea(db, 'a2')
    expect((await db.settings.get('settings'))?.primaryAreaId).toBeNull()
  })
})
