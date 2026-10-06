// 金額・時間・日本時間の暦の共通処理。計算式の正本は docs/spec/docs/02-profitability.md

/** 計算式を変えたら上げる。2：売上見込みにエリアの混み具合を追加。3：オファー判定を追加（docs/spec/docs/02-profitability.md §5） */
export const CALCULATION_VERSION = 7
export const CURRENCY = 'JPY' as const

/** 金額（整数円）として扱える値か確かめる。桁あふれ・小数・NaN は拒否する */
export function assertYen(value: number, label: string, { allowNegative = false } = {}): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} は整数円で入力してください（${value}）`)
  }
  if (!allowNegative && value < 0) {
    throw new RangeError(`${label} に負の値は使えません（${value}）`)
  }
}

/** 割り算。分母が0なら null（「算出不可」）。Infinity や NaN を返さない */
export function divide(numerator: number, denominator: number): number | null {
  if (denominator === 0 || !Number.isFinite(numerator) || !Number.isFinite(denominator)) return null
  return numerator / denominator
}

const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/

/**
 * ISO 8601 日時をミリ秒に。オフセットのない日時や不正な日時は拒否する。
 * 2月30日のような存在しない暦日を、別の日に読み替えずに拒否する。
 */
export function parseInstant(iso: string, label = '日時'): number {
  const m = ISO_INSTANT.exec(iso)
  if (!m) {
    const reason = /T\d{2}:\d{2}/.test(iso) && !/(Z|[+-]\d{2}:\d{2})$/.test(iso) ? 'タイムゾーンがありません' : '日時として読めません'
    throw new RangeError(`${label} に${reason}（${iso}）`)
  }
  const [year, month, day, hour, minute, second = 0] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as number[]
  const millis = m[7] ? Number(m[7].padEnd(3, '0')) : 0
  const offsetHours = m[8] === 'Z' ? 0 : Number(m[10])
  const offsetMinutes = m[8] === 'Z' ? 0 : Number(m[11])
  const wall = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second, millis))
  const isRealCalendarTime =
    wall.getUTCFullYear() === year &&
    wall.getUTCMonth() === month! - 1 &&
    wall.getUTCDate() === day &&
    hour! <= 23 &&
    minute! <= 59 &&
    second <= 59 &&
    offsetHours <= 23 &&
    offsetMinutes <= 59
  if (!isRealCalendarTime) throw new RangeError(`${label} が存在しない日時です（${iso}）`)
  const sign = m[9] === '-' ? -1 : 1
  return wall.getTime() - sign * (offsetHours * 60 + offsetMinutes) * 60_000
}

export interface Span {
  startMs: number
  endMs: number
}

export function toSpan(startAt: string, endAt: string, label = '区間'): Span {
  const startMs = parseInstant(startAt, `${label}の開始`)
  const endMs = parseInstant(endAt, `${label}の終了`)
  if (endMs < startMs) throw new RangeError(`${label}の終了が開始より前です`)
  return { startMs, endMs }
}

/** 区間の和集合（[start,end)）。重なりは1回だけ数える */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = spans.filter((s) => s.endMs > s.startMs).sort((a, b) => a.startMs - b.startMs)
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && span.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, span.endMs)
    } else {
      merged.push({ ...span })
    }
  }
  return merged
}

export function unionSeconds(spans: readonly Span[]): number {
  return mergeSpans(spans).reduce((sum, s) => sum + (s.endMs - s.startMs) / 1000, 0)
}

/** inner の各区間が outer の和集合に完全に含まれるか */
export function isCovered(inner: readonly Span[], outer: readonly Span[]): boolean {
  const merged = mergeSpans(outer)
  return inner.every((span) =>
    merged.some((o) => o.startMs <= span.startMs && span.endMs <= o.endMs),
  )
}

// 日本時間（Asia/Tokyo）は夏時間がないため +9 時間で暦を求める
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 日本時間の日付 YYYY-MM-DD */
export function localDate(iso: string): string {
  return new Date(parseInstant(iso) + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/** 日本時間の月 YYYY-MM */
export function localMonth(iso: string): string {
  return localDate(iso).slice(0, 7)
}

/** 日付 YYYY-MM-DD が属する週の月曜日 */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  const daysSinceMonday = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - daysSinceMonday)
  return d.toISOString().slice(0, 10)
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

export function monthRange(from: string, to: string): string[] {
  const months: string[] = []
  for (let m = from; m <= to; m = addMonths(m, 1)) months.push(m)
  return months
}

export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/**
 * 整数円を重みの比で配る（最大剰余法）。合計は必ず total と一致する。
 * 重みの合計が0なら配れないので null。
 */
export function allocateByWeight(total: number, weights: readonly number[]): number[] | null {
  assertYen(total, '配分額', { allowNegative: true })
  const weightSum = weights.reduce((a, b) => a + b, 0)
  if (weightSum <= 0) return null
  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(total)
  const raw = weights.map((w) => (abs * w) / weightSum)
  const result = raw.map(Math.floor)
  let remainder = abs - result.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (remainder <= 0) break
    result[i] = (result[i] ?? 0) + 1
    remainder -= 1
  }
  return result.map((v) => v * sign)
}
