// 週の計画（仕様 S05・§5）：候補枠ごとの見込み利益と、週の時間内で利益が最大になる組み合わせ
import { divide, monthRange, parseInstant } from './core'
import { MIN_SAMPLE, timeSlotOf, type TimeSlot } from './analytics'
import { averageBusyFactor, weightedBusyHours, type BusynessTable } from './busyness'

export type Scenario = 'pessimistic' | 'standard' | 'optimistic'
export const SCENARIOS: Scenario[] = ['pessimistic', 'standard', 'optimistic']
export const SCENARIO_LABELS: Record<Scenario, string> = { pessimistic: '悲観', standard: '標準', optimistic: '楽観' }

/** 手動の幅（統計的な信頼区間ではない）。標準の売上に掛ける */
export const SCENARIO_FACTORS: Record<Scenario, number> = { pessimistic: 0.8, standard: 1, optimistic: 1.2 }

/**
 * 参考資料（docs/spec/delivery-profitability-reference-2026-10.md）の推計倍率。
 * 「ピーク帯・普通の天気の日」を 1.00 とした目安で、実績ではない。
 */
export const REFERENCE_HOURLY_REVENUE_YEN = 1400
export const TIME_SLOT_FACTORS: Record<TimeSlot, number> = {
  early: 0.55,
  lunch: 1.1,
  idle: 0.65,
  dinner: 1.2,
  late: 0.85,
  night: 0.55,
}
export const MONTH_FACTORS = [1.1, 0.9, 1.0, 0.9, 0.95, 1.05, 1.1, 1.1, 1.05, 0.95, 0.9, 1.15] as const

export interface RevenueEstimate {
  /** 標準シナリオの売上見込み（整数円） */
  revenueYen: number
  source: 'personal_slot' | 'personal' | 'reference' | 'busyness'
  sampleSize: number
  note: string
}

export interface PastSession {
  departedAt: string
  hours: number
  revenueYen: number
}

/** 自分の平均を、混み具合の比で補正する時の上限・下限（偶然の偏りで極端にしない） */
const BUSY_RATIO_MIN = 0.5
const BUSY_RATIO_MAX = 2

/**
 * 候補枠の売上見込み。本人の実績が10回以上ある時は本人の平均（同じ時間帯が10回以上ならその平均）、
 * それ未満は推計を使い、どちらを使ったかを返す。
 * busyness（エリアの混み具合）があれば：
 * - 推計は、時間帯の倍率の代わりに混み具合の段階の倍率を使う（未入力の時間は時間帯の倍率）
 * - 本人の平均は「この枠の混み具合 ÷ 平均に使った実績の混み具合」の比で補正する
 */
export function estimateRevenue(startsAt: string, endsAt: string, past: readonly PastSession[], busyness?: BusynessTable | null): RevenueEstimate {
  const hours = (parseInstant(endsAt) - parseInstant(startsAt)) / 3_600_000
  if (hours <= 0) return { revenueYen: 0, source: 'reference', sampleSize: 0, note: '時間が0以下です' }
  const startMs = parseInstant(startsAt)
  const endMs = parseInstant(endsAt)
  const slot = timeSlotOf(startsAt)
  const perHour = (rows: readonly PastSession[]) =>
    divide(rows.reduce((a, r) => a + r.revenueYen, 0), rows.reduce((a, r) => a + r.hours, 0))
  // 実績の平均を、この枠と実績の混み具合の比で補正する（どちらかが未入力なら補正しない）
  const adjust = (rows: readonly PastSession[]): { ratio: number; note: string } => {
    if (!busyness) return { ratio: 1, note: '' }
    const here = averageBusyFactor(busyness, startMs, endMs)
    let weighted = 0
    let hoursCovered = 0
    for (const r of rows) {
      const s = parseInstant(r.departedAt)
      const f = averageBusyFactor(busyness, s, s + r.hours * 3_600_000)
      if (f === null) continue
      weighted += f * r.hours
      hoursCovered += r.hours
    }
    if (here === null || hoursCovered === 0) return { ratio: 1, note: '' }
    const ratio = Math.min(BUSY_RATIO_MAX, Math.max(BUSY_RATIO_MIN, here / (weighted / hoursCovered)))
    return { ratio, note: `・混み具合で×${ratio.toFixed(2)}` }
  }
  const sameSlot = past.filter((p) => timeSlotOf(p.departedAt) === slot)
  const slotRate = sameSlot.length >= MIN_SAMPLE ? perHour(sameSlot) : null
  if (slotRate !== null) {
    const a = adjust(sameSlot)
    return { revenueYen: Math.round(slotRate * hours * a.ratio), source: 'personal_slot', sampleSize: sameSlot.length, note: `同じ時間帯の自分の実績${sameSlot.length}回の平均${a.note}` }
  }
  const allRate = past.length >= MIN_SAMPLE ? perHour(past) : null
  if (allRate !== null) {
    const a = adjust(past)
    return { revenueYen: Math.round(allRate * hours * a.ratio), source: 'personal', sampleSize: past.length, note: `自分の実績${past.length}回の平均${a.note || '（時間帯は区別していません）'}` }
  }
  const lacking = past.length < MIN_SAMPLE ? `自分の実績が${past.length}回で10回未満のため` : ''
  if (busyness) {
    // 混み具合は今の傾向なので、月の倍率は掛けない。未入力の時間だけ時間帯の倍率を使う
    const { weighted: w, coveredHours } = weightedBusyHours(busyness, startMs, endMs, (ms) => TIME_SLOT_FACTORS[timeSlotOf(new Date(ms).toISOString())])
    if (coveredHours > 0) {
      return {
        revenueYen: Math.round(REFERENCE_HOURLY_REVENUE_YEN * w),
        source: 'busyness',
        sampleSize: past.length,
        note: `推計（${lacking}エリアの混み具合を使用）`,
      }
    }
  }
  // 時間帯が切り替わる時刻で区切り、それぞれの長さ × 倍率を足し合わせる
  let weighted = 0
  for (let t = startMs; t < endMs; ) {
    const segmentEnd = Math.min(endMs, nextSlotBoundary(t))
    weighted += TIME_SLOT_FACTORS[timeSlotOf(new Date(t).toISOString())] * ((segmentEnd - t) / 3_600_000)
    t = segmentEnd
  }
  const month = new Date(startMs + 9 * 3_600_000).getUTCMonth()
  const revenueYen = Math.round(REFERENCE_HOURLY_REVENUE_YEN * weighted * MONTH_FACTORS[month]!)
  return {
    revenueYen,
    source: 'reference',
    sampleSize: past.length,
    note: lacking ? `推計（${lacking}参考資料を使用）` : '推計（参考資料）',
  }
}

/** 時間帯（日本時間 0・7・11・14・17・21時）が次に切り替わる時刻 */
const SLOT_BOUNDARY_HOURS = [0, 7, 11, 14, 17, 21, 24]
const JST_MS = 9 * 3_600_000
function nextSlotBoundary(ms: number): number {
  const jst = ms + JST_MS
  const dayStart = Math.floor(jst / 86_400_000) * 86_400_000
  const hoursIntoDay = (jst - dayStart) / 3_600_000
  const next = SLOT_BOUNDARY_HOURS.find((h) => h > hoursIntoDay) ?? 24
  return dayStart + next * 3_600_000 - JST_MS
}

/**
 * 毎月の固定費を、期間（日本時間の日付・両端含む）の日数で按分した額。
 * 計画は未来の予測なので、実績のような「稼働時間の比」ではなく日割りで見込む。
 */
export function weeklyFixedCostYen(monthly: readonly { month: string; amountYen: number }[], from: string, to: string): number {
  let total = 0
  for (const month of monthRange(from.slice(0, 7), to.slice(0, 7))) {
    const amount = monthly.filter((m) => m.month === month).reduce((a, m) => a + m.amountYen, 0)
    if (amount === 0) continue
    const [y, m] = month.split('-').map(Number) as [number, number]
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const first = from > `${month}-01` ? Number(from.slice(8, 10)) : 1
    const last = to < `${month}-${String(daysInMonth).padStart(2, '0')}` ? Number(to.slice(8, 10)) : daysInMonth
    total += (amount * (last - first + 1)) / daysInMonth
  }
  return Math.round(total)
}

export interface SlotInput {
  id: string
  startsAt: string
  /** 帰宅予定（拘束時間の終わり） */
  endsAt: string
  /** シナリオごとの売上見込み。null は未入力 */
  revenueYen: Record<Scenario, number | null>
  /** 想定レンタル代。null は算出不可（料金の対象外など） */
  rentalYen: number | null
  expenseYen: number
  /** 帰宅締切（日本時間 HH:mm）。過ぎる枠は選ばない */
  homeDeadline?: string | null
}

export type SlotIssue = 'invalid_time' | 'past_deadline' | 'missing_estimate' | 'not_profitable'

export interface SlotEvaluation {
  id: string
  hours: number
  profitYen: Record<Scenario, number | null>
  hourlyYen: Record<Scenario, number | null>
  issues: SlotIssue[]
}

/**
 * 帰宅が締切（日本時間 HH:mm）を過ぎるか。締切は出発の後で最初に来るその時刻
 * （出発20:00・締切01:00なら翌日の01:00）。
 */
function pastDeadline(startsAt: string, endsAt: string, deadline: string): boolean {
  const startJstMs = parseInstant(startsAt) + JST_MS
  const startJst = new Date(startJstMs)
  const [h, m] = deadline.split(':').map(Number) as [number, number]
  let deadlineJst = Date.UTC(startJst.getUTCFullYear(), startJst.getUTCMonth(), startJst.getUTCDate(), h, m)
  if (deadlineJst <= startJstMs) deadlineJst += 86_400_000
  return parseInstant(endsAt) + JST_MS > deadlineJst
}

export function evaluateSlot(slot: SlotInput, scenario: Scenario = 'standard'): SlotEvaluation {
  const issues: SlotIssue[] = []
  const startMs = parseInstant(slot.startsAt)
  const endMs = parseInstant(slot.endsAt)
  const hours = Math.max(0, (endMs - startMs) / 3_600_000)
  if (endMs <= startMs) issues.push('invalid_time')
  if (slot.homeDeadline && endMs > startMs && pastDeadline(slot.startsAt, slot.endsAt, slot.homeDeadline)) issues.push('past_deadline')
  const profitYen = {} as Record<Scenario, number | null>
  const hourlyYen = {} as Record<Scenario, number | null>
  for (const s of ['pessimistic', 'standard', 'optimistic'] as const) {
    const revenue = slot.revenueYen[s]
    profitYen[s] = revenue === null || slot.rentalYen === null ? null : revenue - slot.rentalYen - slot.expenseYen
    hourlyYen[s] = profitYen[s] === null ? null : divide(profitYen[s]!, hours)
  }
  if (profitYen[scenario] === null) issues.push('missing_estimate')
  else if (profitYen[scenario]! <= 0) issues.push('not_profitable')
  return { id: slot.id, hours, profitYen, hourlyYen, issues }
}

export interface WeekPlan {
  scenario: Scenario
  chosenIds: string[]
  /** 選ばなかった理由（重なり・時間の上限は組み合わせの結果） */
  skipped: { id: string; reason: SlotIssue | 'overlap_or_budget' }[]
  totalHours: number
  /** 週あたりに按分した毎月の固定費（利益から差し引き済み） */
  fixedCostYen: number
  profitYen: Record<Scenario, number | null>
  hourlyYen: Record<Scenario, number | null>
}

/**
 * 重ならない候補枠から、帰宅までの時間の合計が週の上限以内で、見込み利益の合計が最大になる組み合わせを選ぶ。
 * 区間スケジューリング＋時間の上限（分単位）の動的計画法で厳密に解く。時給の高い順に選ぶだけでは最適にならない。
 */
export function planWeek(
  slots: readonly SlotInput[],
  budgetMinutes: number | null,
  scenario: Scenario = 'standard',
  fixedCostYen = 0,
): WeekPlan {
  const evaluations = new Map(slots.map((s) => [s.id, evaluateSlot(s, scenario)]))
  const candidates = slots
    .filter((s) => evaluations.get(s.id)!.issues.length === 0)
    .map((s) => ({
      id: s.id,
      start: parseInstant(s.startsAt),
      end: parseInstant(s.endsAt),
      minutes: Math.ceil((parseInstant(s.endsAt) - parseInstant(s.startsAt)) / 60_000),
      value: evaluations.get(s.id)!.profitYen[scenario]!,
    }))
    .sort((a, b) => a.end - b.end || a.start - b.start)

  const budget = budgetMinutes === null ? candidates.reduce((a, c) => a + c.minutes, 0) : Math.max(0, Math.floor(budgetMinutes))
  // prev[i]：i番目の枠より前に終わる最後の枠（重ならない）
  const prev = candidates.map((c, i) => {
    for (let j = i - 1; j >= 0; j--) if (candidates[j]!.end <= c.start) return j
    return -1
  })
  // dp[i][b]：先頭 i 個の枠から、合計 b 分以内で選んだ時の最大利益
  const n = candidates.length
  const dp: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(budget + 1))
  for (let i = 1; i <= n; i++) {
    const c = candidates[i - 1]!
    const p = prev[i - 1]! + 1
    for (let b = 0; b <= budget; b++) {
      const skip = dp[i - 1]![b]!
      const take = c.minutes <= b ? dp[p]![b - c.minutes]! + c.value : -Infinity
      dp[i]![b] = Math.max(skip, take)
    }
  }
  const chosen: string[] = []
  let i = n
  let b = budget
  while (i > 0) {
    const c = candidates[i - 1]!
    if (dp[i]![b] === dp[i - 1]![b]) {
      i -= 1
    } else {
      chosen.push(c.id)
      b -= c.minutes
      i = prev[i - 1]! + 1
    }
  }
  chosen.reverse()

  const chosenSet = new Set(chosen)
  const skipped = slots
    .filter((s) => !chosenSet.has(s.id))
    .map((s) => {
      const issues = evaluations.get(s.id)!.issues
      return { id: s.id, reason: issues[0] ?? ('overlap_or_budget' as const) }
    })
  const totalHours = chosen.reduce((a, id) => a + evaluations.get(id)!.hours, 0)
  const profitYen = {} as Record<Scenario, number | null>
  const hourlyYen = {} as Record<Scenario, number | null>
  for (const s of ['pessimistic', 'standard', 'optimistic'] as const) {
    const values = chosen.map((id) => evaluations.get(id)!.profitYen[s])
    // 固定費は枠を選んでも選ばなくてもかかるので、選び方には影響させず合計からだけ引く
    profitYen[s] = values.some((v) => v === null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0) - fixedCostYen
    hourlyYen[s] = profitYen[s] === null ? null : divide(profitYen[s]!, totalHours)
  }
  return { scenario, chosenIds: chosen, skipped, totalHours, fixedCostYen, profitYen, hourlyYen }
}

/** 装備の必要現金を、計画した週の見込み利益で割った回収の目安（週）。利益が0以下なら null */
export function weeksToRecover(cashNeededYen: number, weeklyProfitYen: number | null): number | null {
  if (cashNeededYen === 0) return 0
  if (weeklyProfitYen === null || weeklyProfitYen <= 0) return null
  return cashNeededYen / weeklyProfitYen
}
