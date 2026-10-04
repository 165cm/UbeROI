// 金額・時間・日本時間の暦の共通処理。計算式の正本は docs/spec/docs/02-profitability.md

export const CALCULATION_VERSION = 1
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

/** ISO 8601 日時をミリ秒に。オフセットのない日時や不正な日時は拒否する */
export function parseInstant(iso: string, label = '日時'): number {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(iso)) {
    throw new RangeError(`${label} にタイムゾーンがありません（${iso}）`)
  }
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new RangeError(`${label} が日時として読めません（${iso}）`)
  return ms
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
