// レンタル料金の計算（docs/spec/docs/02-profitability.md §3）
import { CALCULATION_VERSION, CURRENCY, assertYen, parseInstant } from './core'

/** 段階料金（例：HELLO CYCLING）。秒は1分に切り上げる */
export interface TieredTariff {
  kind: 'tiered'
  initialMinutes: number
  initialYen: number
  stepMinutes: number
  stepYen: number
  /** 見積の対象にする最長利用時間（分）。これを超えたら算出対象外 */
  capMinutes: number
  capYen: number
}

/** 時間パス（例：3時間900円）。利用時間を満たす一番安いパスを選ぶ */
export interface PassTariff {
  kind: 'pass'
  passes: { minutes: number; yen: number }[]
}

/** 自前の車両・月額サブスク。レンタルごとの料金はかからない（経費や装備で計上する） */
export interface NoRentalTariff {
  kind: 'none'
}

export type Tariff = TieredTariff | PassTariff | NoRentalTariff

/** プリセット例：HELLO CYCLING 東京都シティサイクル。地域・事業者で違うため、利用者が選択・編集する */
export const HELLO_TOKYO_CITY: TieredTariff = {
  kind: 'tiered',
  initialMinutes: 30,
  initialYen: 160,
  stepMinutes: 15,
  stepYen: 160,
  capMinutes: 720,
  capYen: 2500,
}

/** 利用分数 m（秒を1分に切り上げ、開始済みなら最低1分） */
export function billableMinutes(elapsedSeconds: number): number {
  return Math.max(1, Math.ceil(elapsedSeconds / 60))
}

export function tieredFee(t: TieredTariff, elapsedSeconds: number): number | null {
  const m = billableMinutes(elapsedSeconds)
  if (m > t.capMinutes) return null
  const steps = Math.ceil(Math.max(0, m - t.initialMinutes) / t.stepMinutes)
  return Math.min(t.capYen, t.initialYen + t.stepYen * steps)
}

/** 料金が次に上がる経過秒。上限到達後や対象外の範囲なら null */
export function tieredNextIncreaseSeconds(t: TieredTariff, elapsedSeconds: number): number | null {
  const fee = tieredFee(t, elapsedSeconds)
  if (fee === null || fee >= t.capYen) return null
  const m = billableMinutes(elapsedSeconds)
  const boundaryMinutes =
    m <= t.initialMinutes
      ? t.initialMinutes
      : t.initialMinutes + t.stepMinutes * Math.ceil((m - t.initialMinutes) / t.stepMinutes)
  const next = boundaryMinutes * 60 + 1
  return next > t.capMinutes * 60 ? null : next
}

/**
 * 段階料金の上限の使い方：上限に達する経過秒と、上限で乗れる最後の秒（それを過ぎると見積の対象外）。
 * 例：HELLO CYCLING 東京都シティサイクルは 240分1秒で 2,500円に達し、720分（12時間）までは増えない
 */
export function tieredCapInfo(t: TieredTariff): { capYen: number; reachesCapAtSeconds: number; coversUntilSeconds: number } {
  const stepsToCap = t.initialYen >= t.capYen ? 0 : Math.ceil((t.capYen - t.initialYen) / t.stepYen)
  const minute = stepsToCap === 0 ? 1 : t.initialMinutes + (stepsToCap - 1) * t.stepMinutes + 1
  return { capYen: t.capYen, reachesCapAtSeconds: (minute - 1) * 60 + 1, coversUntilSeconds: t.capMinutes * 60 }
}

/** 乗る長さ（時間）ごとのレンタル代と、1時間あたり（長く乗るほど上限で下がる）。対象外の長さは null */
export function rentalCostByHours(t: Tariff, hours: readonly number[]): { hours: number; yen: number | null; perHourYen: number | null }[] {
  return hours.map((h) => {
    const yen = feeFor(t, h * 3600)
    return { hours: h, yen, perHourYen: yen === null || h <= 0 ? null : Math.round(yen / h) }
  })
}

export function passFee(t: PassTariff, elapsedSeconds: number): number | null {
  const candidates = t.passes.filter((p) => p.minutes * 60 >= elapsedSeconds).map((p) => p.yen)
  return candidates.length === 0 ? null : Math.min(...candidates)
}

export function feeFor(t: Tariff, elapsedSeconds: number): number | null {
  switch (t.kind) {
    case 'tiered':
      return tieredFee(t, elapsedSeconds)
    case 'pass':
      return passFee(t, elapsedSeconds)
    case 'none':
      return 0
  }
}

export interface RentalInput {
  tariff: Tariff
  startAt?: string | null
  endAt?: string | null
  /** 実請求額。あれば見積より優先する。0円も有効 */
  billedYen?: number | null
}

export interface RentalResult {
  currency: typeof CURRENCY
  calculationVersion: number
  amountYen: number | null
  status: 'not_started' | 'estimated' | 'actual' | 'unsupported'
  estimatedYen: number | null
  /** 実請求額 − 見積 */
  differenceYen: number | null
  elapsedSeconds: number | null
  nextIncreaseAt: string | null
  /** 上限料金に達していて、対象時間内は追加課金なし */
  capped: boolean
  reason?: string
}

/** レンタル1件の料金。endAt がなければ asOf（今）までの見積 */
export function calculateRental(input: RentalInput, asOf?: string): RentalResult {
  const base = { currency: CURRENCY, calculationVersion: CALCULATION_VERSION }
  if (input.billedYen != null) assertYen(input.billedYen, '実請求額')

  let elapsedSeconds: number | null = null
  let estimatedYen: number | null = null
  let nextIncreaseAt: string | null = null
  let capped = false
  let reason: string | undefined

  if (input.startAt) {
    const startMs = parseInstant(input.startAt, 'レンタル開始')
    const endIso = input.endAt ?? asOf
    if (endIso) {
      const endMs = parseInstant(endIso, 'レンタル終了')
      if (endMs < startMs) {
        return {
          ...base,
          amountYen: input.billedYen ?? null,
          status: input.billedYen != null ? 'actual' : 'unsupported',
          estimatedYen: null,
          differenceYen: null,
          elapsedSeconds: null,
          nextIncreaseAt: null,
          capped: false,
          reason: 'レンタル終了が開始より前です',
        }
      }
      elapsedSeconds = Math.floor((endMs - startMs) / 1000)
      estimatedYen = feeFor(input.tariff, elapsedSeconds)
      if (estimatedYen === null) reason = '見積の対象外です。実請求額を入力してください'
      if (input.tariff.kind === 'tiered' && estimatedYen !== null) {
        capped = estimatedYen >= input.tariff.capYen
        if (!input.endAt) {
          const next = tieredNextIncreaseSeconds(input.tariff, elapsedSeconds)
          nextIncreaseAt = next === null ? null : new Date(startMs + next * 1000).toISOString()
        }
      }
    }
  }

  if (input.billedYen != null) {
    return {
      ...base,
      amountYen: input.billedYen,
      status: 'actual',
      estimatedYen,
      differenceYen: estimatedYen === null ? null : input.billedYen - estimatedYen,
      elapsedSeconds,
      nextIncreaseAt,
      capped,
    }
  }
  if (!input.startAt) {
    return {
      ...base,
      amountYen: 0,
      status: 'not_started',
      estimatedYen: 0,
      differenceYen: null,
      elapsedSeconds: null,
      nextIncreaseAt: null,
      capped: false,
    }
  }
  return {
    ...base,
    amountYen: estimatedYen,
    status: estimatedYen === null ? 'unsupported' : 'estimated',
    estimatedYen,
    differenceYen: null,
    elapsedSeconds,
    nextIncreaseAt,
    capped,
    reason: elapsedSeconds === null ? '終了時刻がありません' : reason,
  }
}
