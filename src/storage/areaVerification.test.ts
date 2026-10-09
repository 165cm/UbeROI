import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { areaDayDates, markAreaDays } from './areaVerification'
import { emptyBusyness } from '../domain'
import { areaProblems, saveArea, ensureInitialData } from './repo'
import { DeliKanDB } from './db'
import { createBackup, parseBackup, restoreBackup } from './backup'
import type { AreaRecord } from './schema'

const area = (): AreaRecord => ({ id: 'a', name: '駅前', levels: emptyBusyness().map(r => r.map(() => 2)), towns: [], checkedAt: '2026-09-01', createdAt: '', updatedAt: '', revision: 0 })
it('1曜日の更新で他の曜日の確認日を新しくしない', () => {
  const next = markAreaDays(area(), [1], '2026-10-10')
  expect(next.checkedAt).toBe('2026-09-01')
  expect(areaDayDates(next)[1]).toBe('2026-10-10')
  expect(areaDayDates(next)[2]).toBe('2026-09-01')
  expect(markAreaDays(next, [0, 2, 3, 4, 5, 6], '2026-10-10').checkedAt).toBe('2026-10-10')
})
it('曜日別日付の壊れた形・日付を拒否する', () => {
  expect(areaProblems({ ...area(), checkedByDay: ['2026-10-10'] })).not.toEqual([])
  expect(areaProblems({ ...area(), checkedByDay: Array(7).fill('2026-02-30') })).not.toEqual([])
  expect(areaProblems({ ...area(), checkedByDay: Array(7).fill(null) })).toEqual([])
})

it('曜日別確認日をバックアップで復元し、旧版15も読める', async () => {
  const db = new DeliKanDB('area-verification-test')
  try {
    await ensureInitialData(db)
    await saveArea(db, markAreaDays(area(), [1], '2026-10-10'), false)
    const backup = await createBackup(db, 'real')
    const parsed = parseBackup(JSON.stringify(backup))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    await restoreBackup(db, parsed.backup)
    expect((await db.areas.get('a'))!.checkedByDay![1]).toBe('2026-10-10')
    const legacy = structuredClone(backup); legacy.schema_version = 15
    delete (legacy.datasets.areas[0] as AreaRecord).checkedByDay
    expect(parseBackup(JSON.stringify(legacy)).ok).toBe(true)
    const bad = structuredClone(backup); (bad.datasets.areas[0] as AreaRecord).checkedByDay = ['invalid']
    expect(parseBackup(JSON.stringify(bad)).ok).toBe(false)
  } finally { await db.delete() }
})
