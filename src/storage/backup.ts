// バックアップ（JSON）の書き出し・検証・復元。復元は全体の置き換えのみ（マージしない）
import type { Tariff } from '../domain'
import type { DeliKanDB, DataMode } from './db'
import { isBusynessTable, parseInstant } from '../domain'
import { areaProblems, initialRecords, questProblems, sessionRecordProblems, sessionSetProblems } from './repo'
import { SCHEMA_VERSION, type AreaRecord, type QuestRecord, type SessionRecord } from './schema'

export const APP_VERSION = '0.1.0'

const TABLES = ['settings', 'tariffs', 'sessions', 'recurringExpenses', 'plans', 'assets', 'slots', 'quests', 'areas', 'offers'] as const
type TableName = (typeof TABLES)[number]

export const TABLE_LABELS: Record<TableName, string> = {
  settings: '設定',
  tariffs: '料金',
  sessions: '稼働の記録',
  recurringExpenses: '固定費',
  plans: '装備プラン',
  assets: '登録済みの装備',
  slots: '計画の候補枠',
  quests: 'クエスト',
  areas: 'エリアの混み具合',
  offers: 'オファーの記録',
}

export interface Backup {
  schema_version: number
  exported_at: string
  app_version: string
  mode: DataMode
  datasets: Record<TableName, unknown[]>
}

export async function createBackup(db: DeliKanDB, mode: DataMode): Promise<Backup> {
  return db.transaction('r', TABLES.map((t) => db.table(t)), async () => {
    const datasets = {} as Record<TableName, unknown[]>
    for (const t of TABLES) datasets[t] = await db.table(t).toArray()
    return { schema_version: SCHEMA_VERSION, exported_at: new Date().toISOString(), app_version: APP_VERSION, mode, datasets }
  })
}

export function backupFileName(mode: DataMode, date: string): string {
  return `deli-kan-${mode === 'demo' ? 'demo-' : ''}${date}.json`
}

// ---- 検証 ----

const MAX_PROBLEMS = 20

class Checker {
  problems: string[] = []
  add(path: string, message: string) {
    if (this.problems.length < MAX_PROBLEMS) this.problems.push(`${path}：${message}`)
  }
  obj(v: unknown, path: string): v is Record<string, unknown> {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return true
    this.add(path, '形式が正しくありません')
    return false
  }
  str(o: Record<string, unknown>, key: string, path: string, { nullable = false } = {}) {
    const v = o[key]
    if (nullable && v === null) return
    if (typeof v !== 'string') this.add(`${path}.${key}`, '文字がありません')
  }
  int(o: Record<string, unknown>, key: string, path: string, { nullable = false, min = 0 as number | null } = {}) {
    const v = o[key]
    if (nullable && v === null) return
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || (min !== null && v < min)) this.add(`${path}.${key}`, '整数ではないか、範囲外です')
  }
  num(o: Record<string, unknown>, key: string, path: string, { nullable = false } = {}) {
    const v = o[key]
    if (nullable && v === null) return
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) this.add(`${path}.${key}`, '0以上の数ではありません')
  }
  instant(o: Record<string, unknown>, key: string, path: string, { nullable = false } = {}) {
    const v = o[key]
    if (nullable && v === null) return
    // 画面の計算と同じ厳密な検査（2月30日などを別の日に読み替えない）
    try {
      if (typeof v !== 'string') throw new Error()
      parseInstant(v)
    } catch {
      this.add(`${path}.${key}`, '日時が正しくありません')
    }
  }
  month(o: Record<string, unknown>, key: string, path: string, { nullable = false } = {}) {
    const v = o[key]
    if (nullable && v === null) return
    if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) this.add(`${path}.${key}`, '月（YYYY-MM）が正しくありません')
  }
  oneOf(o: Record<string, unknown>, key: string, path: string, values: readonly (string | null)[]) {
    if (!values.includes(o[key] as string | null)) this.add(`${path}.${key}`, '想定外の値です')
  }
  arr(o: Record<string, unknown>, key: string, path: string): unknown[] {
    const v = o[key]
    if (Array.isArray(v)) return v
    this.add(`${path}.${key}`, '一覧（配列）ではありません')
    return []
  }
  stamped(o: Record<string, unknown>, path: string) {
    this.str(o, 'createdAt', path)
    this.str(o, 'updatedAt', path)
    this.int(o, 'revision', path)
  }
}

function checkTariff(c: Checker, t: unknown, path: string) {
  if (!c.obj(t, path)) return
  const tariff = t as Partial<Tariff> & Record<string, unknown>
  if (tariff.kind === 'tiered') {
    for (const k of ['initialMinutes', 'stepMinutes', 'capMinutes']) c.int(tariff, k, path, { min: 1 })
    for (const k of ['initialYen', 'stepYen', 'capYen']) c.int(tariff, k, path)
  } else if (tariff.kind === 'pass') {
    c.arr(tariff, 'passes', path).forEach((p, i) => {
      if (c.obj(p, `${path}.passes[${i}]`)) {
        c.int(p, 'minutes', `${path}.passes[${i}]`, { min: 1 })
        c.int(p, 'yen', `${path}.passes[${i}]`)
      }
    })
  } else if (tariff.kind !== 'none') {
    c.add(`${path}.kind`, '料金の種類が想定外です')
  }
}

const CATEGORIES = ['vehicle', 'bag', 'helmet', 'mount', 'battery', 'rainwear', 'visibility', 'other'] as const

const RECORD_CHECKS: Record<TableName, (c: Checker, r: Record<string, unknown>, path: string) => void> = {
  settings(c, r, path) {
    if (r.id !== 'settings') c.add(`${path}.id`, '設定のIDが正しくありません')
    c.str(r, 'originLabel', path, { nullable: true })
    c.int(r, 'targetHourlyYen', path, { nullable: true })
    c.int(r, 'weeklyBudgetMinutes', path, { nullable: true })
    c.str(r, 'homeDeadline', path, { nullable: true })
    c.str(r, 'defaultTariffId', path, { nullable: true })
    if (r.lastBackupAt !== undefined) c.instant(r, 'lastBackupAt', path, { nullable: true })
    if (r.primaryAreaId !== undefined) c.str(r, 'primaryAreaId', path, { nullable: true })
    if (r.offerBufferMinutes !== undefined) c.int(r, 'offerBufferMinutes', path)
    if (r.offerMinKmYen !== undefined) c.int(r, 'offerMinKmYen', path, { nullable: true })
    c.stamped(r, path)
  },
  tariffs(c, r, path) {
    c.str(r, 'name', path)
    checkTariff(c, r.tariff, `${path}.tariff`)
    c.str(r, 'sourceUrl', path, { nullable: true })
    c.str(r, 'verifiedAt', path, { nullable: true })
    if (typeof r.archived !== 'boolean') c.add(`${path}.archived`, '真偽値ではありません')
    c.stamped(r, path)
  },
  sessions(c, r, path) {
    c.oneOf(r, 'status', path, ['draft', 'active', 'completed'])
    c.instant(r, 'departedAt', path)
    c.instant(r, 'returnedAt', path, { nullable: true })
    c.oneOf(r, 'platform', path, ['uber', 'demaecan', 'rocketnow', 'other'])
    c.oneOf(r, 'weather', path, [null, 'clear', 'cloudy', 'light_rain', 'heavy_rain', 'hot', 'windy', 'snow'])
    c.str(r, 'areaLabel', path)
    c.oneOf(r, 'revenueMode', path, ['summary'])
    c.int(r, 'baseYen', path, { nullable: true })
    c.int(r, 'tipsYen', path, { nullable: true })
    c.int(r, 'completedCount', path, { nullable: true })
    c.num(r, 'summaryOnlineSeconds', path, { nullable: true })
    c.str(r, 'note', path)
    c.arr(r, 'adjustments', path).forEach((a, i) => {
      const p = `${path}.adjustments[${i}]`
      if (!c.obj(a, p)) return
      c.str(a, 'id', p)
      c.oneOf(a, 'kind', p, ['quest', 'other'])
      c.int(a, 'amountYen', p, { min: null })
    })
    c.arr(r, 'rentals', path).forEach((x, i) => {
      const p = `${path}.rentals[${i}]`
      if (!c.obj(x, p)) return
      c.str(x, 'id', p)
      c.str(x, 'tariffName', p)
      checkTariff(c, x.tariff, `${p}.tariff`)
      c.instant(x, 'startAt', p, { nullable: true })
      c.instant(x, 'endAt', p, { nullable: true })
      c.int(x, 'billedYen', p, { nullable: true })
    })
    c.arr(r, 'directExpenses', path).forEach((e, i) => {
      const p = `${path}.directExpenses[${i}]`
      if (!c.obj(e, p)) return
      c.str(e, 'id', p)
      c.oneOf(e, 'category', p, ['consumable', 'repair', 'communication', 'other'])
      c.int(e, 'amountYen', p)
      c.str(e, 'memo', p)
    })
    if (r.imported !== undefined && r.imported !== null && c.obj(r.imported, `${path}.imported`)) {
      c.oneOf(r.imported, 'source', `${path}.imported`, ['csv-v1'])
      c.str(r.imported, 'externalId', `${path}.imported`)
      c.str(r.imported, 'fingerprint', `${path}.imported`)
    }
    c.stamped(r, path)
  },
  recurringExpenses(c, r, path) {
    c.str(r, 'label', path)
    c.oneOf(r, 'category', path, ['communication', 'insurance', 'subscription', 'other'])
    c.int(r, 'amountYen', path)
    c.month(r, 'startMonth', path)
    c.month(r, 'endMonth', path, { nullable: true })
    c.stamped(r, path)
  },
  plans(c, r, path) {
    c.str(r, 'name', path)
    c.oneOf(r, 'tier', path, ['beginner', 'intermediate', 'advanced', 'custom'])
    c.arr(r, 'items', path).forEach((item, i) => {
      const p = `${path}.items[${i}]`
      if (!c.obj(item, p)) return
      c.str(item, 'id', p)
      c.str(item, 'label', p)
      c.oneOf(item, 'category', p, CATEGORIES)
      c.int(item, 'unitYen', p, { nullable: true })
      c.int(item, 'quantity', p, { min: 1 })
      c.oneOf(item, 'state', p, ['planned', 'purchased', 'owned'])
      c.int(item, 'businessRatioBps', p)
      if (typeof item.businessRatioBps === 'number' && item.businessRatioBps > 10000) c.add(`${p}.businessRatioBps`, '100%を超えています')
      c.int(item, 'lifetimeMonths', p, { min: 1 })
      c.int(item, 'residualYen', p)
      c.str(item, 'assetId', p, { nullable: true })
    })
    c.stamped(r, path)
  },
  assets(c, r, path) {
    c.str(r, 'label', path)
    c.oneOf(r, 'category', path, CATEGORIES)
    c.str(r, 'sourcePlanItemId', path, { nullable: true })
    c.oneOf(r, 'status', path, ['owned', 'purchased'])
    c.instant(r, 'purchasedAt', path, { nullable: r.status !== 'purchased' })
    c.month(r, 'inServiceMonth', path)
    c.int(r, 'unitYen', path)
    c.int(r, 'quantity', path, { min: 1 })
    c.int(r, 'businessRatioBps', path)
    c.int(r, 'managementValueYen', path, { nullable: true })
    c.int(r, 'residualYen', path)
    c.int(r, 'lifetimeMonths', path, { min: 1 })
    c.instant(r, 'soldAt', path, { nullable: true })
    c.int(r, 'businessSaleYen', path, { nullable: true })
    c.stamped(r, path)
  },
  slots(c, r, path) {
    c.instant(r, 'startsAt', path)
    c.instant(r, 'endsAt', path)
    if (typeof r.startsAt === 'string' && typeof r.endsAt === 'string' && Date.parse(r.endsAt) <= Date.parse(r.startsAt)) {
      c.add(`${path}.endsAt`, '帰宅予定が出発予定より後になっていません')
    }
    c.str(r, 'areaLabel', path)
    if (c.obj(r.revenueYen, `${path}.revenueYen`)) {
      for (const k of ['pessimistic', 'standard', 'optimistic']) c.int(r.revenueYen, k, `${path}.revenueYen`, { nullable: true })
    }
    c.str(r, 'estimateNote', path)
    c.int(r, 'rentalOverrideYen', path, { nullable: true })
    c.int(r, 'expenseYen', path)
    c.str(r, 'tariffId', path, { nullable: true })
    c.stamped(r, path)
  },
  quests(c, r, path) {
    c.str(r, 'label', path)
    c.oneOf(r, 'platform', path, ['uber', 'demaecan', 'rocketnow', 'other'])
    c.instant(r, 'startsAt', path)
    c.instant(r, 'endsAt', path)
    if (typeof r.startsAt === 'string' && typeof r.endsAt === 'string' && Date.parse(r.endsAt) <= Date.parse(r.startsAt)) {
      c.add(`${path}.endsAt`, '終了が開始より後になっていません')
    }
    c.oneOf(r, 'rewardMode', path, ['cumulative', 'incremental'])
    c.arr(r, 'tiers', path).forEach((t, i) => {
      const p = `${path}.tiers[${i}]`
      if (!c.obj(t, p)) return
      c.int(t, 'count', p, { min: 1 })
      c.int(t, 'rewardYen', p)
    })
    c.int(r, 'manualOffset', path, { min: null })
    c.stamped(r, path)
  },
  areas(c, r, path) {
    c.str(r, 'name', path)
    if (!isBusynessTable(r.levels)) c.add(`${path}.levels`, '混み具合の表（7曜日×24時間・0〜4）が正しくありません')
    c.arr(r, 'towns', path).forEach((t, i) => {
      if (typeof t !== 'string') c.add(`${path}.towns[${i}]`, '文字ではありません')
    })
    if (r.moveMinutes !== undefined) c.int(r, 'moveMinutes', path, { nullable: true, min: 1 })
    c.stamped(r, path)
  },
  offers(c, r, path) {
    c.instant(r, 'at', path)
    c.int(r, 'payYen', path)
    c.int(r, 'minutes', path)
    c.num(r, 'km', path, { nullable: true })
    c.str(r, 'town', path, { nullable: true })
    c.str(r, 'areaName', path, { nullable: true })
    c.oneOf(r, 'decision', path, ['accept', 'maybe', 'decline'])
    c.int(r, 'hourlyYen', path, { nullable: true, min: null })
    c.oneOf(r, 'outcome', path, ['accepted', 'declined'])
    c.stamped(r, path)
  },
}

export type ParseResult =
  | { ok: true; backup: Backup; counts: Record<TableName, number> }
  | { ok: false; problems: string[] }

/** 復元の前の検証。版が違う・形が壊れている・IDが重なる時は復元しない */
export function parseBackup(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, problems: ['JSONとして読めません。デリ勘で書き出したファイルか確認してください'] }
  }
  const c = new Checker()
  if (!c.obj(raw, 'ファイル')) return { ok: false, problems: c.problems }
  // 古い版（1：候補枠なし、2：クエストなし、3：取り込み元なし、4：エリアなし、5：オファーなし、6：エリアの移動の分なし）のバックアップは、足りない一覧を空として読み込む。
  // 版6までのエリアには移動の分（moveMinutes）が無いが、無ければ移動を候補にしないだけなので、そのままでよい
  // 版3までの記録はすべて手入力なので、取り込み元（imported）は無いままでよい
  if ([1, 2, 3, 4, 5, 6].includes(raw.schema_version as number) && typeof raw.datasets === 'object' && raw.datasets !== null && !Array.isArray(raw.datasets)) {
    raw = { ...raw, schema_version: SCHEMA_VERSION, datasets: { slots: [], quests: [], areas: [], offers: [], ...(raw.datasets as object) } }
  }
  if (!c.obj(raw, 'ファイル')) return { ok: false, problems: c.problems }
  if (raw.schema_version !== SCHEMA_VERSION) {
    return { ok: false, problems: [`データの版（${String(raw.schema_version)}）にこのアプリは対応していません（対応：${SCHEMA_VERSION}）`] }
  }
  c.instant(raw, 'exported_at', 'ファイル')
  c.oneOf(raw, 'mode', 'ファイル', ['real', 'demo'])
  const datasets = raw.datasets
  if (!c.obj(datasets, 'datasets')) return { ok: false, problems: c.problems }
  const counts = {} as Record<TableName, number>
  for (const table of TABLES) {
    const rows = datasets[table]
    if (!Array.isArray(rows)) {
      c.add(TABLE_LABELS[table], '一覧がありません')
      continue
    }
    counts[table] = rows.length
    const ids = new Set<string>()
    rows.forEach((row, i) => {
      const path = `${TABLE_LABELS[table]}[${i + 1}]`
      if (!c.obj(row, path)) return
      if (typeof row.id !== 'string' || row.id === '') c.add(`${path}.id`, 'IDがありません')
      else if (ids.has(row.id)) c.add(`${path}.id`, 'IDが重なっています')
      else ids.add(row.id)
      RECORD_CHECKS[table](c, row, path)
    })
  }
  if ((counts.settings ?? 0) > 1) c.add('設定', '2件以上あります')
  if (c.problems.length) return { ok: false, problems: c.problems }
  // 形が正しければ、保存時と同じ制約（時刻の順序・確定の条件・時間の重なり）も確かめる
  const sessions = datasets.sessions as SessionRecord[]
  sessions.forEach((s, i) => sessionRecordProblems(s).forEach((p) => c.add(`${TABLE_LABELS.sessions}[${i + 1}]`, p)))
  sessionSetProblems(sessions).forEach((p) => c.add(TABLE_LABELS.sessions, p))
  // クエストも保存時と同じ制約（段階が空・同じ件数・累積の減少）で確かめる
  ;(datasets.quests as QuestRecord[]).forEach((q, i) => questProblems(q).forEach((p) => c.add(`${TABLE_LABELS.quests}[${i + 1}]`, p)))
  ;(datasets.areas as AreaRecord[]).forEach((a, i) => areaProblems(a).forEach((p) => c.add(`${TABLE_LABELS.areas}[${i + 1}]`, p)))
  if (c.problems.length) return { ok: false, problems: c.problems }
  return { ok: true, backup: raw as unknown as Backup, counts }
}

/**
 * 全体を置き換える。1つのトランザクションで行うので、途中で失敗したら元のデータのまま残る。
 */
export async function restoreBackup(db: DeliKanDB, backup: Backup): Promise<void> {
  // 設定・料金・プランが空なら初期データで補い、置き換えと同じ1回の書き込みに含める
  const initial = initialRecords()
  const datasets: Record<TableName, unknown[]> = {
    ...backup.datasets,
    settings: backup.datasets.settings.length ? backup.datasets.settings : [initial.settings],
    tariffs: backup.datasets.tariffs.length ? backup.datasets.tariffs : initial.tariffs,
    plans: backup.datasets.plans.length ? backup.datasets.plans : initial.plans,
  }
  await replaceAll(db, datasets)
}

async function replaceAll(db: DeliKanDB, datasets: Record<TableName, unknown[]>): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).clear()
    for (const t of TABLES) await db.table(t).bulkAdd(datasets[t])
  })
}

/** すべて消して、初期状態（料金プリセット・空の設定・3プラン）に戻す */
export async function deleteAllData(db: DeliKanDB): Promise<void> {
  const initial = initialRecords()
  await replaceAll(db, { settings: [initial.settings], tariffs: initial.tariffs, sessions: [], recurringExpenses: [], plans: initial.plans, assets: [], slots: [], quests: [], areas: [], offers: [] })
}

/** バックアップを書き出した日時を設定に残す（ホームでの声かけに使う） */
export async function markBackedUp(db: DeliKanDB, at = new Date().toISOString()): Promise<void> {
  await db.settings.update('settings', { lastBackupAt: at })
}
