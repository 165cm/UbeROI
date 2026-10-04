// 分析用の集計（期間の区切り・内訳・回収の推移・CSV）。計算式は period / investment を使い、ここで別の式を作らない
import { addMonths, divide, lastDayOfMonth, localDate, parseInstant, weekStart } from './core'
import type { CashEvent } from './investment'

export type PeriodKind = 'day' | 'week' | 'month' | 'year'

/** 日付（YYYY-MM-DD）を含む日・週（月曜始まり）・月・年の範囲 */
export function periodRange(kind: PeriodKind, date: string): { from: string; to: string } {
  switch (kind) {
    case 'day':
      return { from: date, to: date }
    case 'week': {
      const from = weekStart(date)
      const d = new Date(`${from}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + 6)
      return { from, to: d.toISOString().slice(0, 10) }
    }
    case 'month':
      return { from: `${date.slice(0, 7)}-01`, to: lastDayOfMonth(date.slice(0, 7)) }
    case 'year':
      return { from: `${date.slice(0, 4)}-01-01`, to: `${date.slice(0, 4)}-12-31` }
  }
}

/** 前後の期間へ移動した時の基準日 */
export function shiftPeriod(kind: PeriodKind, date: string, step: number): string {
  if (kind === 'month') return `${addMonths(date.slice(0, 7), step)}-01`
  if (kind === 'year') return `${Number(date.slice(0, 4)) + step}-01-01`
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + step * (kind === 'week' ? 7 : 1))
  return d.toISOString().slice(0, 10)
}

/** 出発時刻（日本時間）の時間帯。参考資料の区分に合わせる */
export type TimeSlot = 'early' | 'lunch' | 'idle' | 'dinner' | 'late' | 'night'

export const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  early: '朝 7〜11時',
  lunch: 'ランチ 11〜14時',
  idle: '昼下がり 14〜17時',
  dinner: 'ディナー 17〜21時',
  late: '夜 21〜24時',
  night: '深夜 0〜7時',
}

export function timeSlotOf(iso: string): TimeSlot {
  const hour = new Date(parseInstant(iso) + 9 * 3_600_000).getUTCHours()
  if (hour < 7) return 'night'
  if (hour < 11) return 'early'
  if (hour < 14) return 'lunch'
  if (hour < 17) return 'idle'
  if (hour < 21) return 'dinner'
  return 'late'
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

export function weekdayOf(iso: string): string {
  return WEEKDAYS[new Date(`${localDate(iso)}T00:00:00Z`).getUTCDay()]!
}

/** これ未満の件数の内訳は「参考（件数が少ない）」として扱う */
export const MIN_SAMPLE = 10

export interface BreakdownRow {
  key: string
  count: number
  hours: number
  operatingProfitYen: number
  hourlyYen: number | null
  /** 件数が少なく、比較の根拠にしにくい */
  lowSample: boolean
}

/** 内訳。時給は各グループの総利益÷総時間（個別時給の平均ではない） */
export function breakdown<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  value: (item: T) => { hours: number; operatingProfitYen: number },
): BreakdownRow[] {
  const groups = new Map<string, { count: number; hours: number; profit: number }>()
  for (const item of items) {
    const key = keyOf(item)
    const v = value(item)
    const g = groups.get(key) ?? { count: 0, hours: 0, profit: 0 }
    g.count += 1
    g.hours += v.hours
    g.profit += v.operatingProfitYen
    groups.set(key, g)
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      count: g.count,
      hours: g.hours,
      operatingProfitYen: g.profit,
      hourlyYen: divide(g.profit, g.hours),
      lowSample: g.count < MIN_SAMPLE,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

export interface RecoveryPoint {
  /** 日本時間の日付 */
  date: string
  investedYen: number
  cashSurplusYen: number
  /** 投資込み累積キャッシュ（G − I + 売却） */
  netCashYen: number
}

/** 投資込み累積キャッシュの推移（日ごと）。0 を上回ったら回収済み */
export function recoverySeries(events: readonly CashEvent[]): RecoveryPoint[] {
  const sorted = [...events].sort((a, b) => parseInstant(a.at) - parseInstant(b.at))
  const points: RecoveryPoint[] = []
  let invested = 0
  let surplus = 0
  let sale = 0
  for (const e of sorted) {
    if (e.kind === 'revenue') surplus += e.amountYen
    else if (e.kind === 'rental' || e.kind === 'expense') surplus -= e.amountYen
    else if (e.kind === 'investment') invested += e.amountYen
    else sale += e.amountYen
    const date = localDate(e.at)
    const point = { date, investedYen: invested, cashSurplusYen: surplus, netCashYen: surplus - invested + sale }
    if (points.length > 0 && points[points.length - 1]!.date === date) points[points.length - 1] = point
    else points.push(point)
  }
  return points
}

/** 表計算ソフトで数式として実行されないよう、先頭が = + - @ の文字列をエスケープする（数値はそのまま） */
export function csvCell(value: string | number | null): string {
  if (value === null) return ''
  if (typeof value === 'number') return String(value)
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
