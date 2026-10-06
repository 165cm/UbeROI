// 計画：週の稼働量を決めるための材料（docs/spec/docs/02-profitability.md §5.7）。
// まだ予定のない時間から、混み具合と自分の実績で一番稼げそうな時間を、1日1つ・最大3つ出す（見込み。実績には入れない）
import { parseInstant } from './core'
import { busyLevelAt, type BusynessTable } from './busyness'

/** おすすめする時間の長さ（時間） */
export const SUGGEST_WINDOW_HOURS = 3
/** おすすめする時間の数（1日1つまで） */
export const SUGGEST_COUNT = 3

export interface SuggestInput {
  now: string
  /** 探す範囲（表示している週） */
  from: string
  to: string
  busyness: BusynessTable
  /** 予定・実績で埋まっている時間（重なる時間はおすすめしない） */
  busy: readonly { startsAt: string; endsAt: string }[]
  /** 区間の売上の見込み（5.1） */
  estimate: (startsAt: string, endsAt: string) => number
  /** 帰宅締切。出発の時刻から、締切の時刻（ms）を返す。なければ締切なし */
  deadline?: ((startsAt: string) => number) | null
  hours?: number
  count?: number
}

export interface SuggestedWindow {
  startsAt: string
  endsAt: string
  revenueYen: number
  /** 各時間の段階 */
  levels: number[]
}

const HOUR = 3_600_000
/** 日本時間の4時で区切った日（配達の1日） */
const businessDay = (ms: number) => Math.floor((ms + 9 * HOUR - 4 * HOUR) / (24 * HOUR))

export function suggestWindows(input: SuggestInput): SuggestedWindow[] {
  const hours = input.hours ?? SUGGEST_WINDOW_HOURS
  const count = input.count ?? SUGGEST_COUNT
  const now = parseInstant(input.now)
  const from = Math.ceil(Math.max(now, parseInstant(input.from)) / HOUR) * HOUR
  const to = parseInstant(input.to)
  const busy = input.busy.map((b) => [parseInstant(b.startsAt), parseInstant(b.endsAt)] as const)

  const candidates: SuggestedWindow[] = []
  for (let s = from; s + hours * HOUR <= to; s += HOUR) {
    const e = s + hours * HOUR
    if (busy.some(([a, b]) => a < e && b > s)) continue
    const levels: number[] = []
    for (let h = s; h < e; h += HOUR) {
      const l = busyLevelAt(input.busyness, h)
      if (l === null) break
      levels.push(l)
    }
    // 混み具合が入っていない時間を含む枠は比べられないので出さない
    if (levels.length < hours) continue
    const startsAt = new Date(s).toISOString()
    const endsAt = new Date(e).toISOString()
    if (input.deadline && e > input.deadline(startsAt)) continue
    candidates.push({ startsAt, endsAt, revenueYen: input.estimate(startsAt, endsAt), levels })
  }
  // 見込みの大きい順（同じなら早い順）に、ほかと重ならず、1日1つまで選ぶ
  const ordered = [...candidates].sort((a, b) => b.revenueYen - a.revenueYen || a.startsAt.localeCompare(b.startsAt))
  const picked: SuggestedWindow[] = []
  for (const c of ordered) {
    if (picked.length >= count) break
    const day = businessDay(Date.parse(c.startsAt))
    // 同じ日のものと、4時をまたいで時間が重なるものは選ばない
    if (picked.some((p) => businessDay(Date.parse(p.startsAt)) === day || (p.startsAt < c.endsAt && p.endsAt > c.startsAt))) continue
    picked.push(c)
  }
  return picked.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}
