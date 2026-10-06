// クエスト作戦表（docs/spec/docs/02-profitability.md §5.9）。
// 日をまたぐクエスト（日跨ぎ）と、その期間に入る短いクエスト（ピークタイム）を合わせて、
// 段階ごとの目標の件数を、残りの日に「ピークの件数を先に、足りない分を均等に」割り振り、時間と報酬を出す（見込み）
import { parseInstant } from './core'
import { clipToRanges } from './availability'
import type { BusynessTable } from './busyness'
import { tierGains, type QuestTier } from './quest'
import { suggestHours, type SuggestedWindow } from './weekBoard'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const JST = 9 * HOUR
/** 日をまたぐクエスト（作戦の軸）とみなす長さ */
export const MAIN_QUEST_MIN_HOURS = 12

export interface StrategyQuest {
  label: string
  startsAt: string
  endsAt: string
  rewardMode: 'cumulative' | 'incremental'
  tiers: readonly QuestTier[]
  /** 今の件数（調整込み） */
  count: number
}

export interface StrategyInput {
  now: string
  main: StrategyQuest
  /** 短いクエスト（ピーク）の回。軸の期間に入るものだけを使う */
  peaks: readonly StrategyQuest[]
  ordersPerHour: number
  /** 1件あたりの売上の見込み（ボーナスを除く） */
  revenuePerOrderYen: number
  /** 働ける時間（設定）。あれば、ピークはその中の時間だけ数え、まったく重ならないピークは数えない */
  allowed?: readonly (readonly [number, number])[] | null
}

export interface StrategyDay {
  /** その日（日本時間の4時〜翌4時）の始まり */
  startsAt: string
  /** その日のピークで取る件数 */
  peakCount: number
  /** ピークの時間の長さ（これからの分） */
  peakHours: number
  /** ピークの外で足す件数 */
  extraCount: number
  total: number
  /** 働く時間の目安（1時間の件数が0なら null） */
  hours: number | null
}

export interface StrategyGoal {
  tier: number
  target: number
  remaining: number
  days: StrategyDay[]
  hours: number | null
  /** 日跨ぎのこの段階までの報酬＋期間の残りのピークの報酬（まだ届いていない段階の分） */
  bonusYen: number
  /** 目標の件数で割った、1件あたりの上乗せ */
  bonusPerOrderYen: number
  /** 残りの件数の売上の見込み＋報酬 */
  revenueYen: number
}

export interface PeakWarning {
  label: string
  startsAt: string
  endsAt: string
  need: number
  /** 1時間の件数で、その時間内に取れる件数 */
  canDo: number
}

export interface QuestStrategy {
  goals: StrategyGoal[]
  warnings: PeakWarning[]
  /** 働ける時間に入るピーク（作戦の時間の組み立てに使う。重なる部分の始まり〜終わり） */
  peaks: { label: string; startsAt: string; endsAt: string }[]
  /** 働ける時間と重ならないので数えないピーク */
  skippedPeaks: { label: string; startsAt: string; endsAt: string }[]
}

const businessDayStart = (ms: number) => Math.floor((ms + JST - 4 * HOUR) / DAY) * DAY - JST + 4 * HOUR
const round1 = (v: number) => Math.round(v * 10) / 10

/** 段階の中で、まだ届いていない段階の報酬の合計（upTo 段階まで） */
function remainingGains(q: StrategyQuest, upTo = q.tiers.length): number {
  const sorted = [...q.tiers].sort((a, b) => a.count - b.count)
  const gains = tierGains(q.rewardMode, sorted)
  return sorted.slice(0, upTo).reduce((a, t, i) => (q.count >= t.count ? a : a + gains[i]!), 0)
}

export function questStrategy(input: StrategyInput): QuestStrategy {
  const now = parseInstant(input.now)
  const mainStart = parseInstant(input.main.startsAt)
  const mainEnd = parseInstant(input.main.endsAt)
  const from = Math.max(now, mainStart)
  const rate = input.ordersPerHour

  // 残りの日（4時区切り）
  const days: { start: number; end: number }[] = []
  for (let d = businessDayStart(from); d < mainEnd; d += DAY) days.push({ start: Math.max(d, from), end: Math.min(d + DAY, mainEnd) })

  // 期間に入る、まだ終わっていないピーク。その日に取る件数＝最後の段階までの残り
  const inPeriod = input.peaks
    .map((p) => ({ p, s: Math.max(parseInstant(p.startsAt), from), e: Math.min(parseInstant(p.endsAt), mainEnd) }))
    .filter(({ s, e }) => e > s)
  // 働ける時間があれば、ピークはその中の部分だけ（まったく重ならないピークは数えない）
  const clipped = inPeriod.map((x) => ({ ...x, parts: input.allowed ? clipToRanges(x.s, x.e, input.allowed) : [[x.s, x.e] as [number, number]] }))
  const skippedPeaks = clipped
    .filter((x) => x.parts.length === 0)
    .map(({ p, s, e }) => ({ label: p.label, startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString() }))
  const peaks = clipped
    .filter((x) => x.parts.length > 0)
    .map(({ p, parts }) => ({ p, s: parts[0]![0], e: parts[parts.length - 1]![1], hours: parts.reduce((a, [x, y]) => a + (y - x) / HOUR, 0) }))
  const peakNeed = (p: StrategyQuest) => Math.max(0, Math.max(0, ...p.tiers.map((t) => t.count)) - p.count)
  const warnings: PeakWarning[] = peaks
    .map(({ p, s, e, hours }) => ({ label: p.label, startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString(), need: peakNeed(p), canDo: Math.floor(hours * rate) }))
    .filter((w) => w.need > w.canDo)
  const peakBonus = peaks.reduce((a, { p }) => a + remainingGains(p), 0)
  const perOrder = input.revenuePerOrderYen

  const sorted = [...input.main.tiers].sort((a, b) => a.count - b.count)
  const goals: StrategyGoal[] = sorted
    .map((t, i) => {
      const remaining = Math.max(0, t.count - input.main.count)
      const dayPeaks = days.map((d) => {
        const inDay = peaks.filter(({ s }) => s >= d.start && s < d.end)
        return { count: inDay.reduce((a, { p }) => a + peakNeed(p), 0), hours: inDay.reduce((a, x) => a + x.hours, 0) }
      })
      const peakTotal = dayPeaks.reduce((a, d) => a + d.count, 0)
      // ピークの外で足す件数を、残りの日に均等に（端数は前の日から1件ずつ）
      const extra = Math.max(0, remaining - peakTotal)
      const base = days.length ? Math.floor(extra / days.length) : 0
      const rest = days.length ? extra % days.length : 0
      const planDays: StrategyDay[] = days.map((d, k) => {
        const extraCount = base + (k < rest ? 1 : 0)
        const { count: peakCount, hours: peakHours } = dayPeaks[k]!
        // ピークの時間は、取る件数に要る時間より短くても、その時間は働く
        const hours = rate > 0 ? round1(Math.max(peakHours, peakCount / rate) + extraCount / rate) : null
        return { startsAt: new Date(d.start).toISOString(), peakCount, peakHours: round1(peakHours), extraCount, total: peakCount + extraCount, hours }
      })
      const totalCount = planDays.reduce((a, d) => a + d.total, 0)
      const bonusYen = remainingGains(input.main, i + 1) + peakBonus
      return {
        tier: i + 1,
        target: t.count,
        remaining,
        days: planDays,
        hours: rate > 0 ? round1(planDays.reduce((a, d) => a + (d.hours ?? 0), 0)) : null,
        bonusYen,
        bonusPerOrderYen: t.count > 0 ? Math.round(bonusYen / Math.max(t.count, totalCount + input.main.count)) : 0,
        revenueYen: Math.round(totalCount * perOrder) + bonusYen,
      }
    })
    .filter((g) => g.remaining > 0)
  return {
    goals,
    warnings,
    peaks: peaks.map(({ p, s, e }) => ({ label: p.label, startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString() })),
    skippedPeaks,
  }
}

export interface ScheduleInput {
  now: string
  goal: StrategyGoal
  peaks: QuestStrategy['peaks']
  allowed?: readonly (readonly [number, number])[] | null
  /** すでに入っている候補枠・実績（重ねない） */
  busy: readonly { startsAt: string; endsAt: string }[]
  /** そのうち、おすすめに選ばれた候補枠（作戦の時間に数える） */
  planned: readonly { startsAt: string; endsAt: string }[]
  busyness: BusynessTable | null
  estimate: (startsAt: string, endsAt: string) => number
  deadline?: ((startsAt: string) => number) | null
  /** 1時間の件数（ほかの件数を時間にする） */
  ordersPerHour: number
}

export interface ScheduleDay {
  startsAt: string
  /** 作戦のその日の時間 */
  needHours: number
  /** すでに選んだ候補枠でまかなえる時間 */
  plannedHours: number
  /** ほかの日の選んだ候補枠の余りでまかなう時間 */
  creditHours: number
  windows: SuggestedWindow[]
  /** 働ける時間・空き時間に入らなかった時間 */
  shortHours: number
}

/**
 * 作戦の日ごとの時間を、実際の時間に置く：まずその日のピーク（働ける時間の中・空いている部分）、
 * 残りは働ける時間の中から見込みの大きい枠で埋める（5.8 と同じ選び方）。すでに選んだ候補枠の時間は差し引く
 */
export function scheduleStrategy(input: ScheduleInput): { days: ScheduleDay[]; windows: SuggestedWindow[]; hours: number; shortHours: number } {
  const now = parseInstant(input.now)
  const taken: { startsAt: string; endsAt: string }[] = [...input.busy]
  const iso = (ms: number) => new Date(ms).toISOString()
  const bounds = input.goal.days.map((d) => {
    const ds = parseInstant(d.startsAt)
    return { ds, de: businessDayStart(ds) + DAY }
  })
  const plannedOf = (k: number) => {
    const { ds, de } = bounds[k]!
    return round1(input.planned.reduce((a, x) => a + Math.max(0, Math.min(parseInstant(x.endsAt), de) - Math.max(parseInstant(x.startsAt), ds, now)) / HOUR, 0))
  }
  // 日ごとの足りない時間。選んだ候補枠がその日の分より多ければ、余りをほかの日の「ほか」の時間から差し引く（後ろの日から）
  const deficit = input.goal.days.map((d, k) => (d.hours ?? 0) - plannedOf(k))
  const credit = deficit.map(() => 0)
  let surplus = deficit.reduce((a, x) => a + Math.max(0, -x), 0)
  for (let k = deficit.length - 1; k >= 0 && surplus > 0; k--) {
    const extraHours = input.ordersPerHour > 0 ? input.goal.days[k]!.extraCount / input.ordersPerHour : 0
    const cut = Math.min(surplus, Math.max(0, deficit[k]!), extraHours)
    deficit[k]! -= cut
    credit[k] = cut
    surplus -= cut
  }
  const days: ScheduleDay[] = input.goal.days.map((d, k) => {
    const { ds, de } = bounds[k]!
    const plannedHours = plannedOf(k)
    const needHours = d.hours ?? 0
    let left = Math.max(0, deficit[k]!)
    const windows: SuggestedWindow[] = []
    // ① その日のピーク：空いている部分を、そのまま働く時間にする
    for (const p of input.peaks) {
      const ps = parseInstant(p.startsAt)
      if (ps < ds || ps >= de || left <= 0) continue
      let parts: [number, number][] = [[Math.max(ps, now), parseInstant(p.endsAt)]]
      for (const b of taken) {
        const bs = parseInstant(b.startsAt)
        const be = parseInstant(b.endsAt)
        parts = parts.flatMap(([a, z]) => (be <= a || bs >= z ? [[a, z] as [number, number]] : ([[a, Math.min(bs, z)], [Math.max(be, a), z]] as [number, number][]).filter(([x, y]) => y > x)))
      }
      for (const [a, z] of parts) {
        const w: SuggestedWindow = { startsAt: iso(a), endsAt: iso(z), revenueYen: input.estimate(iso(a), iso(z)), levels: [] }
        windows.push(w)
        taken.push(w)
        left -= (z - a) / HOUR
      }
    }
    // ② 残りは、その日の働ける時間の中から見込みの大きい枠で
    if (left > 0.05) {
      const found = suggestHours({
        now: input.now,
        from: iso(ds),
        to: iso(de),
        busyness: input.busyness,
        allowed: input.allowed,
        busy: taken,
        estimate: input.estimate,
        deadline: input.deadline,
        hoursNeeded: round1(left),
      })
      windows.push(...found.windows)
      taken.push(...found.windows)
      left = found.shortHours
    }
    windows.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    return { startsAt: d.startsAt, needHours, plannedHours, creditHours: round1(credit[k]!), windows, shortHours: round1(Math.max(0, left)) }
  })
  const windows = days.flatMap((d) => d.windows)
  return {
    days,
    windows,
    hours: round1(windows.reduce((a, w) => a + (parseInstant(w.endsAt) - parseInstant(w.startsAt)) / HOUR, 0)),
    shortHours: round1(days.reduce((a, d) => a + d.shortHours, 0)),
  }
}
