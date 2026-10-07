// 稼働中の「あと何件続ける？」（docs/spec/docs/02-profitability.md §5.14）。
// 今の件数から、クエストの次の段階・リーダーボードの次の順位・攻める目標まで、あと何件・何分か、
// 終了予定までに届くか（延ばせば届くか）を出す。見込みであり、実績には入れない
import { parseInstant } from './core'
import type { LeaderboardOutlook } from './leaderboard'
import { PACE_MIN_ELAPSED_MINUTES, PACE_WEIGHT } from './outlook'
import { tierGains, type QuestTier } from './quest'

const MIN = 60_000

export interface QuestPushInput {
  now: string
  /** 終了予定（配達をやめる時刻） */
  endAt: string
  /** 配達を続けられる最後の時刻（帰宅締切から家までの分を引いたもの）。なければ null */
  lastAt: string | null
  /** クエストの回の終わり（この後の配達は数えない） */
  questEndsAt: string
  /** 今の件数（確定記録＋この稼働の件数＋調整） */
  count: number
  rewardMode: 'cumulative' | 'incremental'
  tiers: readonly QuestTier[]
  board: LeaderboardOutlook | null
  /** 確定記録からの1時間の件数（ordersPerHour） */
  baseOrdersPerHour: number
  /** この稼働の経った分と件数（今日のペース） */
  sessionMinutes: number
  sessionCount: number
  /** 1時間の売上の見込み（ボーナス別） */
  revenuePerHourYen: number
}

export interface QuestPushGoal {
  /** 例：「第2段階 50件」「4位を抜く」「攻める 5位」 */
  labels: string[]
  /** 目標の件数（その回の数え方） */
  target: number
  more: number
  /** 要る分（1時間の件数が0で出せない時は null） */
  minutes: number | null
  /** 届くと増える段階の報酬 */
  gainYen: number
  /** 延ばした分の時給の目安（ボーナス込み） */
  hourlyYen: number | null
  /** fits＝終了予定までに届く、extend＝延ばせば届く、no＝届かない */
  reach: 'fits' | 'extend' | 'no'
  /** extend の時、終了予定から延ばす分 */
  extendMinutes: number
}

export interface QuestPushResult {
  ordersPerHour: number
  /** 今日のペースを入れたか */
  usesPace: boolean
  goals: QuestPushGoal[]
}

/** 1時間の件数：この稼働が45分以上で1件以上なら、今日のペースと半々 */
export function pushOrdersPerHour(base: number, sessionMinutes: number, sessionCount: number): { rate: number; usesPace: boolean } {
  if (sessionMinutes >= PACE_MIN_ELAPSED_MINUTES && sessionCount > 0) {
    const today = sessionCount / (sessionMinutes / 60)
    return { rate: Math.round((base * (1 - PACE_WEIGHT) + today * PACE_WEIGHT) * 100) / 100, usesPace: true }
  }
  return { rate: base, usesPace: false }
}

export function questPushGoals(input: QuestPushInput): QuestPushResult {
  const { rate, usesPace } = pushOrdersPerHour(input.baseOrdersPerHour, input.sessionMinutes, input.sessionCount)
  const now = parseInstant(input.now)
  const end = parseInstant(input.endAt)
  const questEnd = parseInstant(input.questEndsAt)
  const last = Math.min(questEnd, input.lastAt ? parseInstant(input.lastAt) : questEnd)

  // 目標の候補：まだ届いていない段階のうち次の2つ、すぐ上の順位を抜く件数、攻める目標
  const sorted = [...input.tiers].sort((a, b) => a.count - b.count)
  const gains = tierGains(input.rewardMode, sorted)
  const raw: { label: string; target: number }[] = []
  sorted
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.count > input.count)
    .slice(0, 2)
    .forEach(({ t, i }) => raw.push({ label: `第${i + 1}段階 ${t.count}件`, target: t.count }))
  const b = input.board
  if (b && b.myCount !== null) {
    // リーダーボードの件数（撮った時の件数と今の件数の多い方）と、クエストの件数の差をそろえる
    const offset = b.myCount - input.count
    // まだ抜いていない、一番近い上の順位（撮った時点の件数）
    const next = b.above.find((a) => a.count + 1 > b.myCount!)
    if (next) raw.push({ label: `${next.rank}位を抜く`, target: next.count + 1 - offset })
    if (b.target && b.target.more !== null && b.target.more > 0) raw.push({ label: `攻める ${b.target.rank}位`, target: input.count + b.target.more })
  }

  const byTarget = new Map<number, string[]>()
  for (const r of raw) {
    if (r.target <= input.count) continue
    byTarget.set(r.target, [...(byTarget.get(r.target) ?? []), r.label])
  }
  const goals = [...byTarget.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([target, labels]): QuestPushGoal => {
      const more = target - input.count
      const minutes = rate > 0 ? Math.ceil((more / rate) * 60) : Infinity
      // 届く段階の報酬（今の件数から target までに越える段階）
      const gainYen = sorted.reduce((a, t, i) => a + (t.count > input.count && t.count <= target ? gains[i]! : 0), 0)
      const doneAt = now + minutes * MIN
      const reach = !Number.isFinite(minutes) ? 'no' : doneAt <= Math.min(end, questEnd) ? 'fits' : doneAt <= last ? 'extend' : 'no'
      const hours = minutes / 60
      return {
        labels,
        target,
        more,
        minutes: Number.isFinite(minutes) ? minutes : null,
        gainYen,
        hourlyYen: Number.isFinite(minutes) && hours > 0 ? Math.round((input.revenuePerHourYen * hours + gainYen) / hours) : null,
        reach,
        extendMinutes: reach === 'extend' ? Math.ceil((doneAt - end) / MIN) : 0,
      }
    })
  return { ordersPerHour: rate, usesPace, goals }
}
