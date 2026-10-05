// 続けるか帰るかの判断（仕様 §5・受入 A16・A17）。数値は計算、判定は検証できるルールで出す
import { divide, parseInstant } from './core'
import type { Scenario } from './planning'
import { feeFor, type Tariff } from './tariff'

export type Decision = 'GO' | 'WAIT' | 'STOP'

export interface ContinuationInput {
  /** 今の時刻 */
  now: string
  /** 延長する時間（分） */
  extendMinutes: number
  /** 延長した分の売上の見込み（シナリオごと）。null は未入力 */
  extraRevenueYen: Record<Scenario, number | null>
  /** クエストの期待値の増分（確定したものではない。実績売上には入れない） */
  questGainYen?: number
  /** 延長中にかかる追加の経費（駐輪代など） */
  extraExpenseYen?: number
  /** 返却失敗の期待費用（返す場所が満車などで追加料金がかかる見込み × その確率） */
  returnFailureCostYen?: number
  /** 稼働中のレンタル（なければ null） */
  rental: { tariff: Tariff; startAt: string } | null
  /** やめてからポートで返却するまでの時間（分） */
  minutesToReturnBike?: number
  /** やめてから家に着くまでの時間（分） */
  minutesToHome?: number
  targetHourlyYen: number | null
  /** 帰宅締切（日本時間 HH:mm）。出発の後で最初に来るその時刻 */
  homeDeadline?: string | null
  /** 稼働の出発時刻（締切の日付を決める） */
  departedAt: string
}

export interface ContinuationResult {
  decision: Decision
  reasons: string[]
  deltaHours: number | null
  /** 延長した場合に増えるレンタル代（今返す場合との差。すでに払う分は引かない） */
  extraRentalYen: number | null
  deltaProfitYen: Record<Scenario, number | null>
  hourlyYen: Record<Scenario, number | null>
  /** 延長した場合の帰宅予定 */
  arrivalIfExtended: string
}

const SCENARIOS: Scenario[] = ['pessimistic', 'standard', 'optimistic']
const JST_MS = 9 * 3_600_000

/** 帰宅締切（日本時間 HH:mm）の時刻：基準の時刻の後で最初に来るその時刻 */
export function deadlineMs(departedAt: string, deadline: string): number {
  const startJstMs = parseInstant(departedAt) + JST_MS
  const d = new Date(startJstMs)
  const [h, m] = deadline.split(':').map(Number) as [number, number]
  let ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m)
  if (ms <= startJstMs) ms += 86_400_000
  return ms - JST_MS
}

export function evaluateContinuation(input: ContinuationInput): ContinuationResult {
  const reasons: string[] = []
  const nowMs = parseInstant(input.now)
  const extendMs = input.extendMinutes * 60_000
  const returnBikeMs = (input.minutesToReturnBike ?? 0) * 60_000
  const homeMs = (input.minutesToHome ?? 0) * 60_000
  const arrivalIfExtended = new Date(nowMs + extendMs + homeMs).toISOString()

  // ΔH：今やめる場合と延長する場合の帰宅時刻の差
  const deltaHours = input.extendMinutes > 0 ? input.extendMinutes / 60 : null

  // 追加レンタル＝F(延長して返す時点) − F(今から返す時点)
  let extraRentalYen: number | null = 0
  if (input.rental) {
    const elapsedNow = (nowMs + returnBikeMs - parseInstant(input.rental.startAt)) / 1000
    const feeNow = feeFor(input.rental.tariff, elapsedNow)
    const feeLater = feeFor(input.rental.tariff, elapsedNow + extendMs / 1000)
    extraRentalYen = feeNow === null || feeLater === null ? null : feeLater - feeNow
  }

  const deltaProfitYen = {} as Record<Scenario, number | null>
  const hourlyYen = {} as Record<Scenario, number | null>
  for (const s of SCENARIOS) {
    const revenue = input.extraRevenueYen[s]
    deltaProfitYen[s] =
      revenue === null || extraRentalYen === null
        ? null
        : revenue + (input.questGainYen ?? 0) - extraRentalYen - (input.extraExpenseYen ?? 0) - (input.returnFailureCostYen ?? 0)
    hourlyYen[s] = deltaProfitYen[s] === null || deltaHours === null ? null : divide(deltaProfitYen[s]!, deltaHours)
  }

  const result = (decision: Decision): ContinuationResult => ({
    decision,
    reasons,
    deltaHours,
    extraRentalYen,
    deltaProfitYen,
    hourlyYen,
    arrivalIfExtended,
  })

  // 締切を過ぎるなら、ほかの値に関係なく STOP
  if (input.homeDeadline && nowMs + extendMs + homeMs > deadlineMs(input.departedAt, input.homeDeadline)) {
    reasons.push(`延長すると帰宅締切（${input.homeDeadline}）を過ぎます`)
    return result('STOP')
  }
  // 判断に必要な値が足りない時は WAIT（推定で埋めない）
  if (deltaHours === null) reasons.push('延長する時間が0分なので比べられません')
  if (extraRentalYen === null) reasons.push('レンタル料金が見積の対象外です（料金を確認してください）')
  if (input.targetHourlyYen === null) reasons.push('目標時給が未設定です（設定 → 基本）')
  if (SCENARIOS.some((s) => input.extraRevenueYen[s] === null)) reasons.push('延長した分の売上の見込みが未入力です')
  if (reasons.length) return result('WAIT')

  const target = input.targetHourlyYen!
  const fmt = (v: number) => `${Math.round(v).toLocaleString('ja-JP')}円/時`
  if (hourlyYen.optimistic! < target) {
    reasons.push(`楽観の見込みでも追加の時給 ${fmt(hourlyYen.optimistic!)} が目標 ${fmt(target)} に届きません`)
    return result('STOP')
  }
  if (hourlyYen.pessimistic! >= target) {
    reasons.push(`悲観の見込みでも追加の時給 ${fmt(hourlyYen.pessimistic!)} が目標 ${fmt(target)} 以上です`)
    return result('GO')
  }
  reasons.push(`見込み次第で目標に届くかが変わります（悲観 ${fmt(hourlyYen.pessimistic!)}〜楽観 ${fmt(hourlyYen.optimistic!)}、目標 ${fmt(target)}）`)
  return result('WAIT')
}
