// オファー判定（docs/spec/docs/02-profitability.md §5.2）。報酬・分・km から、レンタル代を引いた実質時給と
// 届け先エリアの混み具合・帰宅締切で ✅受ける／⚠️微妙／❌断る を出す。承諾の操作はしない（利用者が自分で押す）
import { divide, parseInstant } from './core'
import { BUSINESS_DAY_START_HOUR, busyLevelAt, type BusynessTable } from './busyness'
import { deadlineMs } from './continuation'
import { feeFor, type Tariff } from './tariff'
import { TIME_BANDS, type TownRating } from './townLearning'

export type OfferDecision = 'accept' | 'maybe' | 'decline'

export const OFFER_DECISION_LABELS: Record<OfferDecision, string> = {
  accept: '✅ 受ける',
  maybe: '⚠️ 微妙',
  decline: '❌ 断る',
}

/** 届け先エリアの混み具合（配達を終える時刻）で、必要な時給の基準を上げ下げする倍率 */
export const OFFER_LEVEL_THRESHOLD_FACTORS: Record<number, number> = { 1: 1.15, 2: 1.05, 3: 0.95, 4: 0.9 }
/** 基準の何割以上なら「微妙」にするか */
export const OFFER_MAYBE_RATIO = 0.8

export interface ParsedOffer {
  payYen: number | null
  minutes: number | null
  km: number | null
}

const toHalfWidth = (s: string) =>
  s.replace(/[０-９．，￥]/g, (c) => (c === '￥' ? '¥' : c === '．' ? '.' : c === '，' ? ',' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)))

/**
 * 画面の文字（iPhone の「テキストを抽出」の結果など）から、報酬・分・km を取り出す。
 * 例：「¥946」「合計 24 分 (3.7 km)」。読めない値は null（推測で埋めない）
 */
export function parseOfferText(text: string): ParsedOffer {
  const t = toHalfWidth(text)
  const yen = /[¥\\]\s*([\d,]+)/.exec(t) ?? /([\d,]+)\s*円/.exec(t)
  const payYen = yen ? Number(yen[1]!.replace(/,/g, '')) : null
  // 「合計 24 分」があればそれを使う（ほかの「分」の数字と取り違えない）
  const min = /合計\s*(\d+)\s*分/.exec(t) ?? /(\d+)\s*分/.exec(t)
  const km = /(\d+(?:\.\d+)?)\s*km/i.exec(t)
  return {
    payYen: payYen !== null && Number.isSafeInteger(payYen) ? payYen : null,
    minutes: min ? Number(min[1]) : null,
    km: km ? Number(km[1]) : null,
  }
}

/** 画面の文字の中から、登録した地名を探す（長い地名を優先。見つからなければ null） */
export function findTown<T extends { towns: readonly string[] }>(text: string, areas: readonly T[]): { area: T; town: string } | null {
  let best: { area: T; town: string } | null = null
  for (const area of areas) {
    for (const town of area.towns) {
      if (town && text.includes(town) && (!best || town.length > best.town.length)) best = { area, town }
    }
  }
  return best
}

/** 1分あたりのレンタル代の目安（延長した分にかかる料金。段階料金は加算の単位あたり） */
export function rentalYenPerMinute(tariff: Tariff | null | undefined): number {
  if (!tariff) return 0
  if (tariff.kind === 'tiered') return tariff.stepMinutes > 0 ? tariff.stepYen / tariff.stepMinutes : 0
  if (tariff.kind === 'pass') {
    const rates = tariff.passes.filter((p) => p.minutes > 0).map((p) => p.yen / p.minutes)
    return rates.length ? Math.min(...rates) : 0
  }
  return 0
}

export interface OfferInput {
  payYen: number
  minutes: number
  km: number | null
  /** 今の時刻 */
  at: string
  /** 待ち時間などの余裕（分）。オファーの分数に足して時給を出す */
  bufferMinutes: number
  /** 稼働中のレンタル（あれば、この案件で増える料金を料金表から正確に出す） */
  rental?: { tariff: Tariff; startAt: string } | null
  /** レンタル中でない時に使う、1分あたりのレンタル代の目安 */
  rentalYenPerMinute?: number
  targetHourlyYen: number | null
  /** km単価の下限（任意）。下回ったら判定を1段下げる */
  minKmYen?: number | null
  /** 届け先エリアの混み具合の表（見つかった時だけ） */
  destinationBusyness?: BusynessTable | null
  /** 届け先の地名×時間帯の、記録から学習した評価（10件以上の時だけ。あれば混み具合の表より優先） */
  destinationLearned?: TownRating | null
  /** 帰宅締切（日本時間 HH:mm）と、配達を終えてから家までの分。締切を過ぎるなら断る */
  homeDeadline?: string | null
  minutesToHome?: number
  /** 締切の日付を決める基準（稼働の出発時刻。なければ、その日の配達の1日の始まり＝日本時間4時） */
  departedAt?: string | null
}

export interface OfferResult {
  decision: OfferDecision
  reasons: string[]
  /** 報酬 − この案件で増えるレンタル代 */
  netYen: number
  rentalYen: number
  /** 実質時給（余裕の分数を含めた時間で割る） */
  hourlyYen: number | null
  perMinuteYen: number | null
  perKmYen: number | null
  /** 届け先エリアの、配達を終える時刻の段階（不明なら null） */
  arrivalLevel: number | null
  /** 段階をどこから出したか（記録から学習／手で登録した混み具合） */
  arrivalSource: 'learned' | 'busyness' | null
  /** 必要な時給（目標 × 届け先の倍率）。目標が未設定なら null */
  thresholdYen: number | null
}

const JST_MS = 9 * 3_600_000

/**
 * その時刻が入る「配達の1日」の始まり（日本時間4時）。出発時刻が分からない時の締切の基準にする。
 * 例：22:10 は同じ日の4時から、翌1:00 は前の日の4時から（締切22:00は同じ日の22:00になり、翌日に送らない）
 */
export function businessDayStart(iso: string): string {
  const jst = parseInstant(iso) + JST_MS
  const shifted = jst - BUSINESS_DAY_START_HOUR * 3_600_000
  const dayStart = Math.floor(shifted / 86_400_000) * 86_400_000 + BUSINESS_DAY_START_HOUR * 3_600_000
  return new Date(dayStart - JST_MS).toISOString()
}

const steps: OfferDecision[] = ['decline', 'maybe', 'accept']
const lower = (d: OfferDecision): OfferDecision => steps[Math.max(0, steps.indexOf(d) - 1)]!

export function evaluateOffer(input: OfferInput): OfferResult {
  const atMs = parseInstant(input.at)
  const doneMs = atMs + input.minutes * 60_000
  // この案件で増えるレンタル代：レンタル中なら料金表の差、そうでなければ1分あたりの目安
  let rentalYen = 0
  if (input.rental) {
    const elapsed = Math.max(0, (atMs - parseInstant(input.rental.startAt)) / 1000)
    const extra = (input.minutes + input.bufferMinutes) * 60
    const before = feeFor(input.rental.tariff, elapsed)
    const after = feeFor(input.rental.tariff, elapsed + extra)
    rentalYen = before !== null && after !== null ? after - before : Math.round((input.rentalYenPerMinute ?? 0) * (input.minutes + input.bufferMinutes))
  } else {
    rentalYen = Math.round((input.rentalYenPerMinute ?? 0) * (input.minutes + input.bufferMinutes))
  }
  const netYen = input.payYen - rentalYen
  const totalMinutes = input.minutes + input.bufferMinutes
  const hourly = divide(netYen * 60, totalMinutes)
  const hourlyYen = hourly === null ? null : Math.round(hourly)
  const perMinute = divide(input.payYen, input.minutes)
  const perMinuteYen = perMinute === null ? null : Math.round(perMinute * 10) / 10
  const perKm = input.km ? divide(input.payYen, input.km) : null
  const perKmYen = perKm === null ? null : Math.round(perKm)
  const learned = input.destinationLearned ?? null
  const tableLevel = input.destinationBusyness ? busyLevelAt(input.destinationBusyness, doneMs) : null
  const arrivalLevel = learned ? learned.level : tableLevel
  const arrivalSource = learned ? 'learned' : tableLevel !== null ? 'busyness' : null
  const reasons: string[] = []

  const result = (decision: OfferDecision, thresholdYen: number | null): OfferResult => ({
    decision,
    reasons,
    netYen,
    rentalYen,
    hourlyYen,
    perMinuteYen,
    perKmYen,
    arrivalLevel,
    arrivalSource,
    thresholdYen,
  })

  if (input.homeDeadline) {
    const home = doneMs + (input.minutesToHome ?? 0) * 60_000
    if (home > deadlineMs(input.departedAt ?? businessDayStart(input.at), input.homeDeadline)) {
      reasons.push(`配達後に家へ帰ると帰宅締切（${input.homeDeadline}）を過ぎます`)
      return result('decline', null)
    }
  }
  if (input.targetHourlyYen === null) {
    reasons.push('目標の時給が未設定なので、時給だけ表示します（設定 → 基本）')
    return result('maybe', null)
  }
  if (hourlyYen === null) {
    reasons.push('分数が0なので時給を出せません')
    return result('maybe', null)
  }
  const factor = arrivalLevel === null ? 1 : OFFER_LEVEL_THRESHOLD_FACTORS[arrivalLevel]!
  const thresholdYen = Math.round(input.targetHourlyYen * factor)
  if (arrivalLevel !== null) {
    const change = arrivalLevel >= 3 ? `基準を${Math.round((1 - factor) * 100)}%下げました` : `基準を${Math.round((factor - 1) * 100)}%上げました`
    reasons.push(
      learned
        ? `届け先「${learned.town}」の${TIME_BANDS[learned.band]!.label}は、これまで${learned.samples}件で次のオファーまで中央値${learned.medianWaitMinutes}分（段階${arrivalLevel}）なので、${change}`
        : arrivalLevel >= 3
          ? `届け先は配達を終える頃に混む（段階${arrivalLevel}）ので、${change}`
          : `届け先は配達を終える頃に空いている（段階${arrivalLevel}）ので、${change}`,
    )
  }
  let decision: OfferDecision = hourlyYen >= thresholdYen ? 'accept' : hourlyYen >= thresholdYen * OFFER_MAYBE_RATIO ? 'maybe' : 'decline'
  reasons.unshift(
    hourlyYen >= thresholdYen
      ? `実質時給 ${hourlyYen.toLocaleString('ja-JP')}円 は基準 ${thresholdYen.toLocaleString('ja-JP')}円 以上`
      : `実質時給 ${hourlyYen.toLocaleString('ja-JP')}円 は基準 ${thresholdYen.toLocaleString('ja-JP')}円 未満`,
  )
  if (input.minKmYen != null && perKmYen !== null && perKmYen < input.minKmYen) {
    decision = lower(decision)
    reasons.push(`km単価 ${perKmYen}円 が下限 ${input.minKmYen}円 を下回るので、判定を1段下げました`)
  }
  return result(decision, thresholdYen)
}
