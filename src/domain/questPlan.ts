// クエストを軸にした週の組み立て（docs/spec/docs/02-profitability.md §5.5）。
// 今の件数・計画した候補枠・自分の1時間あたりの件数から、どの段階まで届きそうか、次の段階まで何時間か、
// その時間はボーナス込みで時給いくらになるかを出す。見込みであり、実績の売上には入れない
import { divide, parseInstant } from './core'
import type { QuestTier } from './quest'

/** 自分の記録が少ない時（件数の入った確定記録が3回未満）に使う、1時間あたりの件数の目安 */
export const REFERENCE_ORDERS_PER_HOUR = 2
/** 1時間あたりの件数を自分の記録から出すのに必要な、件数の入った確定記録の数 */
export const MIN_ORDER_SAMPLES = 3

export interface OrderRateSession {
  hours: number
  completedCount: number | null
}

/** 自分の1時間あたりの件数（件数の入った確定記録が3回以上ある時。0件の記録ばかりなら0）。なければ目安の2件 */
export function ordersPerHour(sessions: readonly OrderRateSession[]): { rate: number; source: 'personal' | 'reference'; samples: number } {
  const usable = sessions.filter((s) => s.completedCount !== null && s.hours > 0)
  const hours = usable.reduce((a, s) => a + s.hours, 0)
  const count = usable.reduce((a, s) => a + s.completedCount!, 0)
  if (usable.length >= MIN_ORDER_SAMPLES && hours > 0) return { rate: Math.round((count / hours) * 100) / 100, source: 'personal', samples: usable.length }
  return { rate: REFERENCE_ORDERS_PER_HOUR, source: 'reference', samples: usable.length }
}

export interface QuestPlanInput {
  now: string
  /** この回の期間 */
  startsAt: string
  endsAt: string
  rewardMode: 'cumulative' | 'incremental'
  tiers: readonly QuestTier[]
  /** 今の件数（調整込み） */
  count: number
  /** 計画した候補枠（この週に選んだもの） */
  slots: readonly { startsAt: string; endsAt: string }[]
  ordersPerHour: number
  /** 1時間あたりの売上の見込み（ボーナスを除く）。自分の平均か目安 */
  revenuePerHourYen: number
  /** 1時間あたりの費用の見込み（レンタル代・経費。計画した枠の平均。なければ0） */
  costPerHourYen: number
  /** 目標の営業純時給（費用を引いた後）。ボーナス込みの純時給と比べる */
  targetHourlyYen: number | null
}

export interface QuestTierPlan {
  tier: number
  count: number
  /** この段階で増えるボーナス */
  gainYen: number
  /** 今からの残り件数 */
  remaining: number
  /** 計画した枠だけで届くか */
  reachedByPlan: boolean
  /** 計画の後に、さらに必要な時間（届く段階は0） */
  extraHours: number
  /** 追加の時間を働いた時の、費用を引いた時給（ボーナス込み）。追加が要らなければ null */
  extraHourlyYen: number | null
  /** 期間の残り時間で届くか（計画の外も含めて、残りの時間をすべて働いても） */
  possible: boolean
}

export interface QuestPlan {
  /** 計画した枠のうち、これからの、この期間に入る時間 */
  plannedHours: number
  /** 計画どおりに働いた時の見込み件数（今の件数＋計画の時間×1時間の件数） */
  expectedCount: number
  /** 計画どおりで届く段階（0は1つも届かない） */
  expectedTier: number
  /** 計画どおりで新たに届く段階のボーナスの合計（今もう届いている段階の分は入れない） */
  expectedBonusYen: number
  /** 期間の残り時間 */
  hoursLeft: number
  tiers: QuestTierPlan[]
  /** 目標の時給以上になる、計画の次の段階（なければ null） */
  worthIt: QuestTierPlan | null
}

const overlapHours = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / 3_600_000

export function planQuest(input: QuestPlanInput): QuestPlan {
  const now = parseInstant(input.now)
  const start = Math.max(now, parseInstant(input.startsAt))
  const end = parseInstant(input.endsAt)
  const hoursLeft = Math.max(0, (end - start) / 3_600_000)
  const plannedHours = input.slots.reduce((a, s) => a + overlapHours(parseInstant(s.startsAt), parseInstant(s.endsAt), start, end), 0)
  const expectedCount = input.count + Math.floor(plannedHours * input.ordersPerHour)
  const sorted = [...input.tiers].sort((a, b) => a.count - b.count)
  const gains = sorted.map((t, i) => (input.rewardMode === 'cumulative' ? t.rewardYen - (i === 0 ? 0 : sorted[i - 1]!.rewardYen) : t.rewardYen))

  const expectedTier = sorted.filter((t) => expectedCount >= t.count).length
  let expectedBonusYen = 0
  const tiers: QuestTierPlan[] = []
  sorted.forEach((t, i) => {
    if (input.count >= t.count) return // もう届いた段階は出さない
    const remaining = t.count - input.count
    const reachedByPlan = expectedCount >= t.count
    if (reachedByPlan) expectedBonusYen += gains[i]!
    // 計画の後に必要な件数と時間（この段階までのボーナスは、届いていない段階の分をまとめて数える）
    const extraCount = Math.max(0, t.count - expectedCount)
    // 1時間の件数が0の時は、時間を足しても件数が増えないので届かない
    const canEarn = input.ordersPerHour > 0
    const extraHours = canEarn ? Math.round((extraCount / input.ordersPerHour) * 10) / 10 : 0
    const unreachedGain = sorted.slice(0, i + 1).reduce((a, _, j) => (expectedCount >= sorted[j]!.count ? a : a + gains[j]!), 0)
    const extraHourly = canEarn && extraHours > 0 ? divide((input.revenuePerHourYen - input.costPerHourYen) * extraHours + unreachedGain, extraHours) : null
    tiers.push({
      tier: i + 1,
      count: t.count,
      gainYen: gains[i]!,
      remaining,
      reachedByPlan,
      extraHours,
      extraHourlyYen: extraHourly === null ? null : Math.round(extraHourly),
      possible: canEarn && remaining / input.ordersPerHour <= hoursLeft,
    })
  })
  // 計画の次の段階で、追加の時間がボーナス込みで目標の時給以上になる最初のもの
  const worthIt =
    input.targetHourlyYen === null
      ? null
      : (tiers.find((t) => !t.reachedByPlan && t.possible && t.extraHourlyYen !== null && t.extraHourlyYen >= input.targetHourlyYen!) ?? null)
  return { plannedHours: Math.round(plannedHours * 10) / 10, expectedCount, expectedTier, expectedBonusYen, hoursLeft: Math.round(hoursLeft * 10) / 10, tiers, worthIt }
}
