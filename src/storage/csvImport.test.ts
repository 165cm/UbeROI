// 独自CSVの取り込み（受入 A19：同じCSVの2回取込・途中の不正行）
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCsv } from '../domain'
import { parseBackup, createBackup } from './backup'
import { CSV_V1_COLUMNS, CSV_V1_SAMPLE, commitCsvImport, previewCsvImport } from './csvImport'
import { DeliKanDB } from './db'
import { ValidationError, emptySession, ensureInitialData, saveSession } from './repo'
import { periodFor } from './toDomain'

let db: DeliKanDB
let n = 0

beforeEach(async () => {
  db = new DeliKanDB(`csv-test-${n++}`)
  await ensureInitialData(db)
})

afterEach(async () => {
  await db.delete()
})

const HEADER = CSV_V1_COLUMNS.join(',')
const row = (id: string, day: string, extra: Partial<Record<string, string>> = {}) => {
  const v: Record<string, string> = {
    external_id: id,
    departed_at: `${day}T18:00:00+09:00`,
    returned_at: `${day}T21:00:00+09:00`,
    online_minutes: '150',
    completed_count: '10',
    base_yen: '6600',
    tips_yen: '180',
    bonus_yen: '400',
    rental_yen: '1760',
    direct_expense_yen: '200',
    area_label: 'サンプルエリア',
    ...extra,
  }
  return CSV_V1_COLUMNS.map((c) => v[c]).join(',')
}
const csv = (...rows: string[]) => [HEADER, ...rows].join('\r\n') + '\r\n'

describe('parseCsv', () => {
  it('BOM・CRLF・引用符の中のカンマと改行と "" を扱う', () => {
    const r = parseCsv('﻿a,b\r\n"x,1","He said ""hi""\nok"\r\n\r\n3,\n')
    expect(r).toEqual({ ok: true, rows: [['a', 'b'], ['x,1', 'He said "hi"\nok'], ['3', '']] })
  })
  it('閉じていない引用符は読めないとする', () => {
    expect(parseCsv('a\n"x').ok).toBe(false)
  })
})

describe('CSVの取り込み', () => {
  it('見本（仕様の fixtures と同じ）を取り込むと、売上・レンタル・経費・時間が正しく入る', async () => {
    expect(CSV_V1_SAMPLE.replace(/\r\n/g, '\n')).toBe(readFileSync('docs/spec/fixtures/sessions-v1.csv', 'utf8'))
    const preview = previewCsvImport(CSV_V1_SAMPLE, [], 'uber')
    expect(preview.ok).toBe(true)
    expect(preview.counts).toEqual({ new: 1, duplicate: 0, conflict: 0 })

    expect(await commitCsvImport(db, CSV_V1_SAMPLE, 'uber')).toEqual({ added: 1, skipped: 0 })
    const [s] = await db.sessions.toArray()
    expect(s!.departedAt).toBe('2026-10-04T09:00:00.000Z')
    expect(s!.summaryOnlineSeconds).toBe(9000)
    expect(s!.rentals).toMatchObject([{ startAt: null, endAt: null, billedYen: 1760 }])
    expect(s!.imported).toMatchObject({ source: 'csv-v1', externalId: 'synthetic-001' })

    const { totals } = periodFor({ sessions: [s!], recurringExpenses: [], assets: [] }, '2026-10-04', '2026-10-04')
    expect(totals.revenueYen).toBe(7180)
    expect(totals.rentalYen).toBe(1760)
    expect(totals.operatingProfitYen).toBe(7180 - 1760 - 200)
    expect(totals.hours).toBe(3)
  })

  it('A19：同じCSVを2回取り込んでも二重に登録しない', async () => {
    const text = csv(row('a-1', '2026-10-01'), row('a-2', '2026-10-02'))
    expect(await commitCsvImport(db, text, 'uber')).toEqual({ added: 2, skipped: 0 })
    const again = previewCsvImport(text, await db.sessions.toArray(), 'uber')
    expect(again.counts).toEqual({ new: 0, duplicate: 2, conflict: 0 })
    expect(again.ok).toBe(false)
    expect(again.problems).toEqual([])
    expect(await commitCsvImport(db, text, 'uber')).toEqual({ added: 0, skipped: 2 })
    // 時差の書き方や数の先頭の0が違っても、同じ中身なら取込済みとして扱う
    const reformatted = csv(row('a-1', '2026-10-01', { departed_at: '2026-10-01T09:00:00Z', tips_yen: '0180' }))
    expect(previewCsvImport(reformatted, await db.sessions.toArray(), 'uber').counts).toEqual({ new: 0, duplicate: 1, conflict: 0 })
    expect(await db.sessions.count()).toBe(2)
  })

  it('A19：途中に不正な行があれば、確定前に止めて1件も保存しない', async () => {
    const text = csv(row('b-1', '2026-10-01'), row('b-2', '2026-10-02', { base_yen: '1,200' }), row('b-3', '2026-10-03'))
    const preview = previewCsvImport(text, [], 'uber')
    expect(preview.ok).toBe(false)
    expect(preview.problems).toEqual([expect.stringContaining('3行目：')])
    await expect(commitCsvImport(db, text, 'uber')).rejects.toBeInstanceOf(ValidationError)
    expect(await db.sessions.count()).toBe(0)
  })

  it('取込済みのIDで中身が違う行は、上書きせず競合として止める', async () => {
    await commitCsvImport(db, csv(row('c-1', '2026-10-01')), 'uber')
    const changed = csv(row('c-1', '2026-10-01', { tips_yen: '500' }), row('c-2', '2026-10-02'))
    const preview = previewCsvImport(changed, await db.sessions.toArray(), 'uber')
    expect(preview.counts).toEqual({ new: 1, duplicate: 0, conflict: 1 })
    expect(preview.ok).toBe(false)
    await expect(commitCsvImport(db, changed, 'uber')).rejects.toBeInstanceOf(ValidationError)
    const all = await db.sessions.toArray()
    expect(all).toHaveLength(1)
    expect(all[0]!.tipsYen).toBe(180)
  })

  it('列の不足・時差のない日時・オンラインが拘束時間より長い・ファイル内のID重複を知らせる', () => {
    expect(previewCsvImport('external_id,departed_at\nx,2026-10-01T18:00:00+09:00\n', [], 'uber').problems[0]).toContain('必要な列がありません')
    const p = previewCsvImport(
      csv(
        row('d-1', '2026-10-01', { departed_at: '2026-10-01T18:00:00' }),
        row('d-2', '2026-10-02', { online_minutes: '181' }),
        row('d-3', '2026-10-03'),
        row('d-3', '2026-10-04'),
        row('d-5', '2026-10-05', { returned_at: '2026-10-05T17:00:00+09:00' }),
      ),
      [],
      'uber',
    )
    expect(p.ok).toBe(false)
    expect(p.problems).toEqual([
      expect.stringMatching(/^2行目：.*タイムゾーンがありません/),
      expect.stringMatching(/^3行目：オンライン分数/),
      expect.stringMatching(/^5行目：.*4行目と重なっています/),
      expect.stringMatching(/^6行目：帰宅は出発より後/),
    ])
  })

  it('すでにある記録や、ファイル内の別の行と時間が重なる行を止める', async () => {
    await saveSession(db, { ...emptySession('2026-10-01T10:00:00.000Z', 'completed'), returnedAt: '2026-10-01T12:00:00.000Z', baseYen: 0 })
    const p = previewCsvImport(
      csv(
        row('e-1', '2026-10-01', { departed_at: '2026-10-01T20:00:00+09:00', returned_at: '2026-10-01T22:00:00+09:00', online_minutes: '60' }),
        row('e-2', '2026-10-02'),
        row('e-3', '2026-10-02', { departed_at: '2026-10-02T20:00:00+09:00', returned_at: '2026-10-02T23:00:00+09:00' }),
      ),
      await db.sessions.toArray(),
      'uber',
    )
    expect(p.problems).toEqual([expect.stringMatching(/^2行目：すでにある記録と/), expect.stringMatching(/^4行目：3行目と/)])
  })

  it('platform 列があれば行ごとに使い、想定外の値は止める。知らない列は読み込まずに知らせる', () => {
    const header = `${HEADER},platform,memo`
    const ok = previewCsvImport(`${header}\n${row('f-1', '2026-10-01')},demaecan,x\n${row('f-2', '2026-10-02')},,y\n`, [], 'rocketnow')
    expect(ok.rows.map((r) => r.session.platform)).toEqual(['demaecan', 'rocketnow'])
    expect(ok.warnings).toEqual([expect.stringContaining('memo')])
    // platform 列のサービスを変えた行は、取込済みでも中身が違うとして止める
    const imported = ok.rows.map((r) => ({ ...r.session, createdAt: 'x', updatedAt: 'x', revision: 1 }))
    const changed = previewCsvImport(`${header}\n${row('f-1', '2026-10-01')},uber,x\n${row('f-2', '2026-10-02')},,y\n`, imported, 'uber')
    expect(changed.counts).toEqual({ new: 0, duplicate: 1, conflict: 1 })
    const bad = previewCsvImport(`${header}\n${row('f-3', '2026-10-01')},ubereats,x\n`, [], 'uber')
    expect(bad.problems).toEqual([expect.stringMatching(/^2行目：platform/)])
  })

  it('文字化け（UTF-8 以外で保存）は、保存し直す方法を案内する', () => {
    expect(previewCsvImport('��,x\n', [], 'uber').problems[0]).toContain('CSV UTF-8')
  })

  it('取り込んだ記録はバックアップから復元できる', async () => {
    await commitCsvImport(db, CSV_V1_SAMPLE, 'uber')
    const parsed = parseBackup(JSON.stringify(await createBackup(db, 'real')))
    expect(parsed.ok).toBe(true)
    const broken = await createBackup(db, 'real')
    ;(broken.datasets.sessions[0] as { imported: unknown }).imported = { source: 'other', externalId: 1 }
    expect(parseBackup(JSON.stringify(broken)).ok).toBe(false)
  })
})
