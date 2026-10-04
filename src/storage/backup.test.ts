// バックアップと復元（受入 A20・A28）
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeliKanDB } from './db'
import { backupFileName, createBackup, deleteAllData, markBackedUp, parseBackup, restoreBackup } from './backup'
import { acquirePlanItem, emptySession, ensureInitialData, saveRecurringExpense, saveSession } from './repo'
import { periodFor, recoveryFor } from './toDomain'

let db: DeliKanDB
let n = 0

beforeEach(async () => {
  db = new DeliKanDB(`backup-${n++}`)
  await ensureInitialData(db)
})

afterEach(async () => {
  await db.delete()
})

async function seed() {
  const tariff = (await db.tariffs.toArray()).find((t) => t.tariff.kind === 'tiered')!
  await saveSession(db, {
    ...emptySession('2026-10-04T09:00:00Z', 'completed'),
    returnedAt: '2026-10-04T12:00:00Z',
    baseYen: 6780,
    tipsYen: 0,
    adjustments: [{ id: 'q1', kind: 'quest', amountYen: 400 }],
    rentals: [{ id: 'r1', tariffName: tariff.name, tariff: tariff.tariff, startAt: '2026-10-04T09:00:00Z', endAt: '2026-10-04T12:00:00Z', billedYen: null }],
    directExpenses: [{ id: 'e1', category: 'consumable', amountYen: 200, memo: '=SUM(A1)' }],
  })
  await saveRecurringExpense(db, { id: 'phone', label: '通信', category: 'communication', amountYen: 1000, startMonth: '2026-10', endMonth: null })
  const plan = (await db.plans.where('tier').equals('beginner').first())!
  plan.items[0]!.unitYen = 30000
  await db.plans.put(plan)
  await acquirePlanItem(db, plan.id, plan.items[0]!.id, { state: 'purchased', purchasedAt: '2026-10-01T03:00:00Z' })
}

const snapshot = async (d: DeliKanDB) => ({
  sessions: await d.sessions.toArray(),
  recurringExpenses: await d.recurringExpenses.toArray(),
  assets: await d.assets.toArray(),
})

const sortById = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id))

describe('A20 書き出し → 全削除 → 復元', () => {
  it('原票・ID・計算結果が一致する', async () => {
    await seed()
    const before = await snapshot(db)
    const text = JSON.stringify(await createBackup(db, 'real'))
    await deleteAllData(db)
    expect(await db.sessions.count()).toBe(0)
    expect(await db.plans.count()).toBe(3) // 初期状態に戻る

    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.counts.sessions).toBe(1)
    await restoreBackup(db, parsed.backup)

    const after = await snapshot(db)
    expect(sortById(after.sessions)).toEqual(sortById(before.sessions))
    expect(sortById(after.assets)).toEqual(sortById(before.assets))
    expect(periodFor(after, '2026-10-01', '2026-10-31').totals).toEqual(periodFor(before, '2026-10-01', '2026-10-31').totals)
    expect(recoveryFor(after, '2026-10-31T00:00:00Z')).toEqual(recoveryFor(before, '2026-10-31T00:00:00Z'))
  })

  it('知らない版・壊れたJSON・不正な値・IDの重なりは拒否し、今のデータは変わらない', async () => {
    await seed()
    const good = await createBackup(db, 'real')
    const before = await snapshot(db)

    expect(parseBackup('{not json').ok).toBe(false)
    expect(parseBackup(JSON.stringify({ ...good, schema_version: 99 }))).toMatchObject({ ok: false })

    const badAmount = structuredClone(good)
    ;(badAmount.datasets.sessions[0] as { baseYen: number }).baseYen = 12.5
    const r1 = parseBackup(JSON.stringify(badAmount))
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.problems.join()).toContain('baseYen')

    const dupId = structuredClone(good)
    dupId.datasets.sessions.push(structuredClone(dupId.datasets.sessions[0]))
    expect(parseBackup(JSON.stringify(dupId)).ok).toBe(false)

    const badDate = structuredClone(good)
    ;(badDate.datasets.sessions[0] as { departedAt: string }).departedAt = '2026-10-04 18:00'
    expect(parseBackup(JSON.stringify(badDate)).ok).toBe(false)

    expect(await snapshot(db)).toEqual(before)
  })

  it('復元が途中で失敗したら、元のデータのまま残る', async () => {
    await seed()
    const before = await snapshot(db)
    const broken = await createBackup(db, 'real')
    // 検証をすり抜けた想定：主キーのない行で書き込みを失敗させる
    broken.datasets.assets.push({ label: 'x' })
    await expect(restoreBackup(db, broken)).rejects.toThrow()
    expect(await snapshot(db)).toEqual(before)
  })
})

describe('レビュー指摘：保存時と同じ制約で検証する', () => {
  it('存在しない日時（2月30日）は拒否する', async () => {
    await seed()
    const b = await createBackup(db, 'real')
    ;(b.datasets.sessions[0] as { departedAt: string }).departedAt = '2026-02-30T00:00:00Z'
    expect(parseBackup(JSON.stringify(b)).ok).toBe(false)
  })

  it('時間が重なる記録・帰宅＜出発・帰宅のない確定記録は拒否する', async () => {
    await seed()
    const good = await createBackup(db, 'real')
    const overlap = structuredClone(good)
    overlap.datasets.sessions.push({ ...(structuredClone(good.datasets.sessions[0]) as object), id: 'other' })
    const r = parseBackup(JSON.stringify(overlap))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.join()).toContain('重なって')

    const reversed = structuredClone(good)
    ;(reversed.datasets.sessions[0] as { returnedAt: string }).returnedAt = '2026-10-04T08:00:00Z'
    expect(parseBackup(JSON.stringify(reversed)).ok).toBe(false)

    const noReturn = structuredClone(good)
    ;(noReturn.datasets.sessions[0] as { returnedAt: string | null }).returnedAt = null
    expect(parseBackup(JSON.stringify(noReturn)).ok).toBe(false)
  })

  it('設定・料金・プランが空のバックアップでも、初期データを同じ書き込みで用意する', async () => {
    await seed()
    const b = await createBackup(db, 'real')
    b.datasets.settings = []
    b.datasets.tariffs = []
    b.datasets.plans = []
    b.datasets.assets = []
    const parsed = parseBackup(JSON.stringify(b))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    await restoreBackup(db, parsed.backup)
    expect(await db.settings.count()).toBe(1)
    expect(await db.tariffs.count()).toBe(3)
    expect(await db.plans.count()).toBe(3)
    expect(await db.sessions.count()).toBe(1)
  })
})

describe('候補枠の検証', () => {
  it('帰宅予定が出発予定以前の候補枠は復元しない', async () => {
    const b = await createBackup(db, 'real')
    const now = new Date().toISOString()
    b.datasets.slots = [
      {
        id: 's1',
        startsAt: '2026-10-05T08:00:00Z',
        endsAt: '2026-10-05T08:00:00Z',
        areaLabel: '',
        revenueYen: { pessimistic: null, standard: null, optimistic: null },
        estimateNote: '',
        rentalOverrideYen: null,
        expenseYen: 0,
        tariffId: null,
        createdAt: now,
        updatedAt: now,
        revision: 1,
      },
    ]
    expect(parseBackup(JSON.stringify(b)).ok).toBe(false)
  })
})

describe('データの版の移行', () => {
  it('版1（計画の候補枠がない頃）のバックアップも、候補枠を空として復元できる', async () => {
    await seed()
    const v2 = await createBackup(db, 'real')
    const { slots: _omit, ...v1Datasets } = v2.datasets
    const v1 = { ...v2, schema_version: 1, datasets: v1Datasets }
    const parsed = parseBackup(JSON.stringify(v1))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.counts.slots).toBe(0)
    await restoreBackup(db, parsed.backup)
    expect(await db.sessions.count()).toBe(1)
  })
})

describe('最終バックアップ日時', () => {
  it('書き出した日時を設定に残し、バックアップにも含めて復元できる', async () => {
    await markBackedUp(db, '2026-10-05T01:00:00Z')
    expect((await db.settings.get('settings'))?.lastBackupAt).toBe('2026-10-05T01:00:00Z')
    const parsed = parseBackup(JSON.stringify(await createBackup(db, 'demo')))
    expect(parsed.ok).toBe(true)
    expect(backupFileName('demo', '2026-10-05')).toBe('deli-kan-demo-2026-10-05.json')
  })
})
