// 独自CSV（v1）の取り込み（docs/spec/docs/03-data-model.md「CSV v1」、受入 A19）
// 1行＝確定した稼働1回。全行を確かめてから、問題がなければ1回の書き込みでまとめて保存する（部分保存しない）
import { parseCsv, parseInstant, type Platform } from '../domain'
import type { DeliKanDB } from './db'
import { ValidationError, newId, sessionEndMs, sessionRecordProblems } from './repo'
import type { SessionRecord } from './schema'

export const CSV_V1_COLUMNS = [
  'external_id',
  'departed_at',
  'returned_at',
  'online_minutes',
  'completed_count',
  'base_yen',
  'tips_yen',
  'bonus_yen',
  'rental_yen',
  'direct_expense_yen',
  'area_label',
] as const
type Column = (typeof CSV_V1_COLUMNS)[number]

/** 任意の列。あれば行ごとのサービスに使い、なければ画面で選んだサービスにする */
const OPTIONAL_COLUMNS = ['platform'] as const
const PLATFORMS: readonly Platform[] = ['uber', 'demaecan', 'rocketnow', 'other']

export const MAX_IMPORT_ROWS = 2000
const MAX_PROBLEMS = 30

/** 見本（合成データ。docs/spec/fixtures/sessions-v1.csv と同じ） */
export const CSV_V1_SAMPLE =
  CSV_V1_COLUMNS.join(',') +
  '\r\nsynthetic-001,2026-10-04T18:00:00+09:00,2026-10-04T21:00:00+09:00,150,10,6600,180,400,1760,200,サンプルエリア\r\n'

export interface ImportRow {
  /** ファイルの行番号（見出しが1行目） */
  line: number
  externalId: string
  /** new＝追加する、duplicate＝取込済みで同じ中身（飛ばす）、conflict＝取込済みで中身が違う（止める） */
  status: 'new' | 'duplicate' | 'conflict'
  session: SessionRecord
}

export interface ImportPreview {
  /** 確定できるか（問題・競合がなく、追加が1件以上） */
  ok: boolean
  problems: string[]
  warnings: string[]
  rows: ImportRow[]
  counts: { new: number; duplicate: number; conflict: number }
}

const NAT = /^\d+$/

/** 取込済みかどうかを比べるための、行の中身の正規形（日時はUTCにそろえる。サービスの選択は含めない） */
function fingerprint(values: Record<Column, string>): string {
  return CSV_V1_COLUMNS.map((c) => {
    if (c === 'departed_at' || c === 'returned_at') return new Date(parseInstant(values[c])).toISOString()
    if (c === 'external_id' || c === 'area_label') return values[c]
    // 数は「0180」と「180」を同じにそろえる
    return String(Number(values[c]))
  }).join('\u001f')
}

/**
 * CSVを読んで、追加・取込済み・競合に分けた確認用の一覧を作る。保存はしない。
 * existing は今の記録（取込済みの判定と、時間の重なりの確認に使う）
 */
export function previewCsvImport(text: string, existing: readonly SessionRecord[], defaultPlatform: Platform): ImportPreview {
  const problems: string[] = []
  const warnings: string[] = []
  const rows: ImportRow[] = []
  const counts = { new: 0, duplicate: 0, conflict: 0 }
  const fail = (message: string): ImportPreview => ({ ok: false, problems: [message], warnings, rows: [], counts })
  const add = (message: string) => {
    if (problems.length < MAX_PROBLEMS) problems.push(message)
    else if (problems.length === MAX_PROBLEMS) problems.push('ほかにも問題があります。上の分を直してから、もう一度読み込んでください')
  }

  if (text.includes('�')) return fail('文字化けしています。表計算ソフトで「CSV UTF-8」形式を選んで保存し直してください')
  const parsed = parseCsv(text)
  if (!parsed.ok) return fail(parsed.problem)
  const [header, ...body] = parsed.rows
  if (!header) return fail('ファイルが空です')

  // 列の確認：必須の列がそろっているか、同じ名前の列が2つないか
  const names = header.map((h) => h.trim())
  const index = new Map<string, number>()
  names.forEach((name, i) => {
    if (index.has(name)) add(`1行目：列「${name}」が2つあります`)
    index.set(name, i)
  })
  const missing = CSV_V1_COLUMNS.filter((c) => !index.has(c))
  if (missing.length) add(`1行目：必要な列がありません（${missing.join(', ')}）。見本のCSVと同じ見出しにしてください`)
  const unknown = names.filter((n) => !(CSV_V1_COLUMNS as readonly string[]).includes(n) && !(OPTIONAL_COLUMNS as readonly string[]).includes(n))
  if (unknown.length) warnings.push(`使わない列があります（${unknown.join(', ')}）。この列は読み込みません`)
  if (problems.length) return { ok: false, problems, warnings, rows: [], counts }
  if (body.length === 0) return fail('記録の行がありません（見出しの1行だけです）')
  if (body.length > MAX_IMPORT_ROWS) return fail(`行が多すぎます（${MAX_IMPORT_ROWS}行まで）。ファイルを分けてください`)

  const importedById = new Map<string, SessionRecord>()
  for (const s of existing) if (s.imported) importedById.set(s.imported.externalId, s)
  const seenInFile = new Map<string, number>()
  // 時間の重なりを確かめる相手（今の記録＋このファイルで追加する行）
  const spans: { start: number; end: number; label: string }[] = existing.map((s) => ({
    start: parseInstant(s.departedAt),
    end: sessionEndMs(s),
    label: 'すでにある記録',
  }))

  body.forEach((cells, i) => {
    const line = i + 2
    const at = `${line}行目`
    if (cells.length !== names.length) {
      add(`${at}：列の数が見出しと合いません（見出し${names.length}列、この行${cells.length}列）`)
      return
    }
    const get = (c: string) => (cells[index.get(c)!] ?? '').trim()
    const v = Object.fromEntries(CSV_V1_COLUMNS.map((c) => [c, get(c)])) as Record<Column, string>
    const rowProblems: string[] = []

    if (v.external_id === '') rowProblems.push('external_id が空です')
    const instant = (c: 'departed_at' | 'returned_at', label: string): number | null => {
      if (v[c] === '') {
        rowProblems.push(`${label}（${c}）が空です`)
        return null
      }
      try {
        return parseInstant(v[c], label)
      } catch (e) {
        rowProblems.push(`${(e as Error).message}。2026-10-04T18:00:00+09:00 のように時差まで書いてください`)
        return null
      }
    }
    const departedMs = instant('departed_at', '出発')
    const returnedMs = instant('returned_at', '帰宅')
    const nat = (c: Column, label: string): number | null => {
      if (!NAT.test(v[c]) || !Number.isSafeInteger(Number(v[c]))) {
        rowProblems.push(`${label}（${c}）は0以上の整数で書いてください（今：「${v[c]}」）`)
        return null
      }
      return Number(v[c])
    }
    const onlineMinutes = nat('online_minutes', 'オンライン分数')
    const count = nat('completed_count', '件数')
    const base = nat('base_yen', '基本報酬')
    const tips = nat('tips_yen', 'チップ')
    const bonus = nat('bonus_yen', 'クエスト・ボーナス')
    const rental = nat('rental_yen', 'レンタル代')
    const expense = nat('direct_expense_yen', '経費')
    if (departedMs !== null && returnedMs !== null) {
      if (returnedMs <= departedMs) rowProblems.push('帰宅は出発より後にしてください')
      else if (onlineMinutes !== null && onlineMinutes * 60_000 > returnedMs - departedMs) {
        rowProblems.push('オンライン分数が、出発から帰宅までの時間より長くなっています')
      }
    }
    let platform = defaultPlatform
    if (index.has('platform') && get('platform') !== '') {
      const p = get('platform') as Platform
      if (PLATFORMS.includes(p)) platform = p
      else rowProblems.push(`platform は ${PLATFORMS.join(' / ')} のどれかにしてください（今：「${get('platform')}」）`)
    }
    if (rowProblems.length) {
      rowProblems.forEach((p) => add(`${at}：${p}`))
      return
    }

    const firstLine = seenInFile.get(v.external_id)
    if (firstLine !== undefined) {
      add(`${at}：external_id「${v.external_id}」が${firstLine}行目と重なっています`)
      return
    }
    seenInFile.set(v.external_id, line)

    const fp = fingerprint(v)
    const session: SessionRecord = {
      id: newId(),
      status: 'completed',
      departedAt: new Date(departedMs!).toISOString(),
      returnedAt: new Date(returnedMs!).toISOString(),
      platform,
      weather: null,
      areaLabel: v.area_label,
      revenueMode: 'summary',
      baseYen: base,
      tipsYen: tips,
      completedCount: count,
      adjustments: bonus! > 0 ? [{ id: newId(), kind: 'quest', amountYen: bonus! }] : [],
      summaryOnlineSeconds: onlineMinutes! * 60,
      // CSVにはレンタルの時刻がないので推測せず、実請求額だけの記録にする
      rentals: rental! > 0 ? [{ id: newId(), tariffName: 'CSV取込（実請求額）', tariff: { kind: 'none' }, startAt: null, endAt: null, billedYen: rental! }] : [],
      directExpenses: expense! > 0 ? [{ id: newId(), category: 'other', amountYen: expense!, memo: 'CSV取込' }] : [],
      note: '',
      imported: { source: 'csv-v1', externalId: v.external_id, fingerprint: fp },
      createdAt: '',
      updatedAt: '',
      revision: 0,
    }

    const already = importedById.get(v.external_id)
    if (already) {
      const status = already.imported!.fingerprint === fp ? 'duplicate' : 'conflict'
      counts[status]++
      rows.push({ line, externalId: v.external_id, status, session: already })
      if (status === 'conflict') {
        add(`${at}：external_id「${v.external_id}」は取込済みですが、中身が違います。上書きはしません。記録を直すか、この行を外してください`)
      }
      return
    }

    sessionRecordProblems(session).forEach((p) => add(`${at}：${p}`))
    const start = departedMs!
    const end = returnedMs!
    const overlap = spans.find((s) => start < s.end && s.start < end)
    if (overlap) add(`${at}：${overlap.label}と時間が重なっています`)
    spans.push({ start, end, label: `${line}行目` })
    counts.new++
    rows.push({ line, externalId: v.external_id, status: 'new', session })
  })

  return { ok: problems.length === 0 && counts.new > 0, problems, warnings, rows, counts }
}

/**
 * 取り込みを確定する。保存の直前に今の記録でもう一度確かめ、1回の書き込みで全行を保存する。
 * 問題が1つでもあれば何も保存しない。戻り値は追加・取込済みの件数
 */
export async function commitCsvImport(
  db: DeliKanDB,
  text: string,
  defaultPlatform: Platform,
): Promise<{ added: number; skipped: number }> {
  return db.transaction('rw', db.sessions, async () => {
    const preview = previewCsvImport(text, await db.sessions.toArray(), defaultPlatform)
    if (preview.problems.length) throw new ValidationError(preview.problems)
    const now = new Date().toISOString()
    const added = preview.rows.filter((r) => r.status === 'new').map((r) => ({ ...r.session, createdAt: now, updatedAt: now, revision: 1 }))
    await db.sessions.bulkAdd(added)
    return { added: added.length, skipped: preview.counts.duplicate }
  })
}
