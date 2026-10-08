import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { calculateSession, questProgress } from '../domain'
import { DeliKanDB } from './db'
import { emptySession, saveSession, sessionRecordProblems } from './repo'
import { createBackup, parseBackup, restoreBackup } from './backup'
import { sessionToInput, periodFor } from './toDomain'
import { questSession, serviceCount } from './services'
import type { SessionRecord } from './schema'

const session = (): SessionRecord => ({ ...emptySession('2026-10-08T09:00:00Z', 'completed'),
  returnedAt: '2026-10-08T12:00:00Z', baseYen: 4000, tipsYen: 200, completedCount: 5,
  adjustments: [{ id: 'additional:0:bonus', kind: 'quest', amountYen: 500 }],
  additionalServices: [{ platform: 'rocketnow', baseYen: 3000, tipsYen: 100, bonusYen: 600, adjustmentYen: -100, completedCount: 4 }],
  rentals: [{ id: 'r', tariffName: '自転車', tariff: { kind: 'none' }, startAt: null, endAt: null, billedYen: 1000 }],
  directExpenses: [{ id: 'e', category: 'other', amountYen: 200, memo: '' }], summaryOnlineSeconds: 7200,
})

it('掛け持ち売上を合算し、経費・拘束・オンライン時間を重複させない', () => {
  const r = calculateSession(sessionToInput(session()))
  expect(r).toMatchObject({ revenueYen: 8300, rentalYen: 1000, directExpenseYen: 200, operatingProfitYen: 7100, hours: 3, onlineHours: 2, completedCount: 9, valid: true })
  expect(periodFor({ sessions: [session()], assets: [], recurringExpenses: [] }, '2026-10-08', '2026-10-08').totals.revenueYen).toBe(8300)
})

it('クエストにはサービスごとの件数だけを入れる。未入力を0件にしない', () => {
  const s = session()
  expect(questSession(s, 'uber').completedCount).toBe(5)
  expect(questSession(s, 'rocketnow').completedCount).toBe(4)
  expect(questSession(s, 'demaecan').eligible).toBe(false)
  const q = { startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z', rewardMode: 'cumulative' as const, tiers: [{ count: 10, rewardYen: 1000 }], manualOffset: 0 }
  expect(questProgress(q, [questSession(s, 'rocketnow')], '2026-10-09T00:00:00Z').count).toBe(4)
  s.additionalServices![0]!.completedCount = null
  expect(serviceCount(s)).toBeNull()
})

it('未入力基本報酬・サービス重複・不正な金額と件数を保存させない', () => {
  for (const patch of [{ baseYen: null }, { baseYen: -1 }, { platform: 'uber' as const }, { bonusYen: -1 }, { completedCount: 1.5 }, { tipsYen: Infinity }]) {
    const s = session(); Object.assign(s.additionalServices![0]!, patch)
    expect(sessionRecordProblems(s).length).toBeGreaterThan(0)
  }
  const draft = session(); draft.status = 'draft'; draft.additionalServices![0]!.baseYen = null
  expect(sessionRecordProblems(draft)).toEqual([])
  expect(calculateSession(sessionToInput(draft)).valid).toBe(false)
})

it('追加サービスをバックアップ・復元し、旧版14の単独記録も読み込む', async () => {
  const db = new DeliKanDB('multi-service-backup')
  try {
    const s = session(); await saveSession(db, s)
    const backup = await createBackup(db, 'real')
    const parsed = parseBackup(JSON.stringify(backup)); expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    await restoreBackup(db, parsed.backup)
    expect((await db.sessions.get(s.id))!.additionalServices).toEqual(s.additionalServices)
    const legacy = structuredClone(backup); legacy.schema_version = 14
    delete (legacy.datasets.sessions[0] as SessionRecord).additionalServices
    expect(parseBackup(JSON.stringify(legacy)).ok).toBe(true)
    const bad = structuredClone(backup); (bad.datasets.sessions[0] as SessionRecord).additionalServices![0]!.platform = 'uber'
    expect(parseBackup(JSON.stringify(bad)).ok).toBe(false)
  } finally { await db.delete() }
})
