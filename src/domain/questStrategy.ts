// クエスト作戦表（docs/spec/docs/02-profitability.md §5.9）。
// 日をまたぐクエスト（日跨ぎ）と、その期間に入る短いクエスト（ピークタイム）を合わせて、
// 段階ごとの目標の件数を、残りの日に「ピークの件数を先に、足りない分を均等に」割り振り、時間と報酬を出す（見込み）
import { parseInstant } from './core'
import { tierGains, type QuestTier } from './quest'

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
  const peaks = input.peaks
    .map((p) => ({ p, s: Math.max(parseInstant(p.startsAt), from), e: Math.min(parseInstant(p.endsAt), mainEnd) }))
    .filter(({ s, e }) => e > s)
  const peakNeed = (p: StrategyQuest) => Math.max(0, Math.max(0, ...p.tiers.map((t) => t.count)) - p.count)
  const warnings: PeakWarning[] = peaks
    .map(({ p, s, e }) => ({ label: p.label, startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString(), need: peakNeed(p), canDo: Math.floor(((e - s) / HOUR) * rate) }))
    .filter((w) => w.need > w.canDo)
  const peakBonus = peaks.reduce((a, { p }) => a + remainingGains(p), 0)
  const perOrder = input.revenuePerOrderYen

  const sorted = [...input.main.tiers].sort((a, b) => a.count - b.count)
  const goals: StrategyGoal[] = sorted
    .map((t, i) => {
      const remaining = Math.max(0, t.count - input.main.count)
      const dayPeaks = days.map((d) => {
        const inDay = peaks.filter(({ s }) => s >= d.start && s < d.end)
        return { count: inDay.reduce((a, { p }) => a + peakNeed(p), 0), hours: inDay.reduce((a, { s, e }) => a + (e - s) / HOUR, 0) }
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
  return { goals, warnings }
}
