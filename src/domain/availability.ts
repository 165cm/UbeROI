// 働ける時間（設定 → 基本）。曜日ごとの時間帯（日本時間）。計画のおすすめ・クエストのための時間・作戦は、この中だけで組む。
// 終了が開始以前（例：19:00〜02:00）は、翌日の終了とみなす
const HOUR = 3_600_000
const DAY = 24 * HOUR
const JST = 9 * HOUR

export interface TimeRange {
  /** HH:mm */
  start: string
  end: string
}

/** 曜日ごとの働ける時間（0＝日曜 … 6＝土曜）。空の曜日は働かない日 */
export type WeeklyAvailability = TimeRange[][]

export const AVAILABILITY_MAX_RANGES = 3

const all = (r: TimeRange[]): WeeklyAvailability => Array.from({ length: 7 }, () => r.map((x) => ({ ...x })))
const byDay = (weekday: TimeRange[], weekend: TimeRange[]): WeeklyAvailability =>
  Array.from({ length: 7 }, (_, d) => (d === 0 || d === 6 ? weekend : weekday).map((x) => ({ ...x })))

export const AVAILABILITY_PRESETS: { key: string; label: string; note: string; days: WeeklyAvailability }[] = [
  { key: 'side-night', label: '🌙 副業：平日は夜だけ', note: '平日 19:00〜23:00・土日 10:00〜22:00', days: byDay([{ start: '19:00', end: '23:00' }], [{ start: '10:00', end: '22:00' }]) },
  { key: 'morning', label: '☀️ 午後はパート：午前だけ', note: '毎日 7:00〜12:00', days: all([{ start: '07:00', end: '12:00' }]) },
  { key: 'peaks', label: '🍱 昼と夜のピークだけ', note: '毎日 11:00〜14:00・17:00〜21:00', days: all([{ start: '11:00', end: '14:00' }, { start: '17:00', end: '21:00' }]) },
  { key: 'weekend', label: '📅 土日中心', note: '平日 なし・土日 9:00〜22:00', days: byDay([], [{ start: '09:00', end: '22:00' }]) },
  { key: 'full', label: '💪 専業：毎日たっぷり', note: '毎日 10:00〜23:00', days: all([{ start: '10:00', end: '23:00' }]) },
]

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

export function availabilityProblems(av: unknown): string[] {
  if (!Array.isArray(av) || av.length !== 7) return ['働ける時間は7曜日分で入れてください']
  const problems: string[] = []
  av.forEach((day, d) => {
    if (!Array.isArray(day)) return void problems.push('働ける時間の形が正しくありません')
    if (day.length > AVAILABILITY_MAX_RANGES) problems.push(`1日の時間帯は${AVAILABILITY_MAX_RANGES}つまでです`)
    for (const r of day as TimeRange[]) {
      if (!r || !TIME.test(r.start) || !TIME.test(r.end)) problems.push('働ける時間は 19:00 のように入れてください')
      else if (r.start === r.end) problems.push(`${'日月火水木金土'[d]}曜：開始と終了が同じです`)
    }
  })
  return [...new Set(problems)]
}

/** 1週間で働ける時間の合計（時間） */
export function weeklyAvailableHours(av: WeeklyAvailability): number {
  return av.flat().reduce((a, r) => a + ((minutes(r.end) - minutes(r.start) + 1440) % 1440 || 1440) / 60, 0)
}

/** [from, to) の中の、働ける時間の区間（日本時間の曜日・時刻から。重なりはまとめる） */
export function availabilityRanges(av: WeeklyAvailability, fromMs: number, toMs: number): [number, number][] {
  const out: [number, number][] = []
  // 前の日の夜から続く時間帯もあるので、1日前から見る
  const firstDay = Math.floor((fromMs + JST) / DAY) * DAY - JST - DAY
  for (let d = firstDay; d < toMs; d += DAY) {
    const weekday = new Date(d + JST).getUTCDay()
    for (const r of av[weekday] ?? []) {
      const s = d + minutes(r.start) * 60_000
      let e = d + minutes(r.end) * 60_000
      if (e <= s) e += DAY
      const a = Math.max(s, fromMs)
      const b = Math.min(e, toMs)
      if (b > a) out.push([a, b])
    }
  }
  out.sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const r of out) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  return merged
}

/** 区間 [s, e) と、働ける時間の重なり（区間のリスト） */
export function clipToRanges(s: number, e: number, ranges: readonly (readonly [number, number])[]): [number, number][] {
  return ranges.map(([a, b]) => [Math.max(a, s), Math.min(b, e)] as [number, number]).filter(([a, b]) => b > a)
}
