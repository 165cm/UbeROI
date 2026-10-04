// 稼働1回（出発〜帰宅）の収益（docs/spec/docs/02-profitability.md §1〜2）
import {
  CALCULATION_VERSION,
  CURRENCY,
  assertYen,
  divide,
  isCovered,
  parseInstant,
  toSpan,
  unionSeconds,
  type Span,
} from './core'
import { calculateRental, type RentalInput } from './tariff'

export type Platform = 'uber' | 'demaecan' | 'rocketnow' | 'other'

export interface DeliveryInput {
  id: string
  status: 'completed' | 'cancelled'
  baseYen: number
  tipYen: number
  acceptedAt?: string | null
  completedAt?: string | null
}

export interface AdjustmentInput {
  /** 一意の明細ID。同じIDは1回だけ計上する */
  id: string
  kind: 'quest' | 'other'
  amountYen: number
}

export interface SessionInput {
  status: 'draft' | 'active' | 'completed'
  departedAt: string
  returnedAt?: string | null
  platform?: Platform
  revenueMode: 'summary' | 'detail'
  /** 簡易モードの集計値。null は未入力 */
  baseYen?: number | null
  tipsYen?: number | null
  completedCount?: number | null
  deliveries?: DeliveryInput[]
  adjustments?: AdjustmentInput[]
  onlineIntervals?: { startAt: string; endAt: string }[]
  /** CSV取込などの集計オンライン秒。実測区間があればそちらを使う */
  summaryOnlineSeconds?: number | null
  rentals?: RentalInput[]
  directExpensesYen?: number[]
}

export interface SessionContext {
  /** 月額の固定費のうち、この稼働に配った額 */
  fixedCostYen?: number
  /** 装備・車両の管理配賦のうち、この稼働に配った額 */
  allocatedInvestmentYen?: number
  /** 稼働中の見積に使う現在時刻 */
  asOf?: string
}

export interface SessionResult {
  currency: typeof CURRENCY
  calculationVersion: number
  /** 確定集計に使えるか（帰宅済み・入力エラーなし） */
  valid: boolean
  revenueYen: number
  deliveryRevenueYen: number
  adjustmentYen: number
  rentalYen: number | null
  directExpenseYen: number
  fixedCostYen: number
  costYen: number | null
  operatingProfitYen: number | null
  allocatedInvestmentYen: number
  afterAllocationProfitYen: number | null
  hours: number | null
  onlineHours: number | null
  activeHours: number | null
  hourlyYen: number | null
  afterAllocationHourlyYen: number | null
  onlineRevenueHourlyYen: number | null
  /** 配達中の売上時給（ボーナス・調整は含めない） */
  activeRevenueHourlyYen: number | null
  idleRate: number | null
  completedCount: number | null
  profitPerDeliveryYen: number | null
  rentalCostRate: number | null
  errors: string[]
  warnings: string[]
}

export function calculateSession(session: SessionInput, context: SessionContext = {}): SessionResult {
  const errors: string[] = []
  const warnings: string[] = []
  const fixedCostYen = context.fixedCostYen ?? 0
  const allocatedInvestmentYen = context.allocatedInvestmentYen ?? 0
  assertYen(fixedCostYen, '固定費の配分')
  assertYen(allocatedInvestmentYen, '投資配賦', { allowNegative: true })

  // 時間 H：出発〜帰宅（未帰宅なら確定集計に使えない）
  const departedMs = parseInstant(session.departedAt, '出発')
  let hours: number | null = null
  let sessionSpan: Span | null = null
  const endIso = session.returnedAt ?? (session.status !== 'completed' ? context.asOf : undefined)
  if (session.returnedAt) {
    const returnedMs = parseInstant(session.returnedAt, '帰宅')
    if (returnedMs <= departedMs) errors.push('帰宅が出発より後になっていません')
  } else if (session.status === 'completed') {
    errors.push('帰宅時刻がありません')
  }
  if (endIso) {
    const endMs = parseInstant(endIso, '帰宅')
    if (endMs > departedMs) {
      sessionSpan = { startMs: departedMs, endMs }
      hours = (endMs - departedMs) / 3_600_000
    }
  }

  // 売上 R：採用モードの分だけ。調整（クエスト等）は明細IDごとに1回だけ足す
  let deliveryRevenueYen = 0
  let completedCount = session.completedCount ?? null
  if (session.revenueMode === 'summary') {
    if (session.baseYen == null) errors.push('基本報酬が未入力です')
    const base = session.baseYen ?? 0
    const tips = session.tipsYen ?? 0
    assertYen(base, '基本報酬')
    assertYen(tips, 'チップ')
    deliveryRevenueYen = base + tips
  } else {
    const done = (session.deliveries ?? []).filter((d) => d.status === 'completed')
    for (const d of done) {
      assertYen(d.baseYen, '配達の基本報酬')
      assertYen(d.tipYen, '配達のチップ')
      deliveryRevenueYen += d.baseYen + d.tipYen
    }
    completedCount = done.length
  }
  const seen = new Set<string>()
  let adjustmentYen = 0
  for (const adj of session.adjustments ?? []) {
    if (seen.has(adj.id)) {
      warnings.push(`同じ明細ID（${adj.id}）の調整は1回だけ計上しました`)
      continue
    }
    seen.add(adj.id)
    assertYen(adj.amountYen, '調整額', { allowNegative: true })
    adjustmentYen += adj.amountYen
  }
  const revenueYen = deliveryRevenueYen + adjustmentYen

  // オンライン時間 O と配達時間 A（どちらも和集合）
  let onlineSeconds: number | null = null
  const onlineSpans = (session.onlineIntervals ?? []).map((i) => toSpan(i.startAt, i.endAt, 'オンライン区間'))
  if (onlineSpans.length > 0) {
    if (sessionSpan && !isCovered(onlineSpans, [sessionSpan])) {
      errors.push('オンライン区間が出発〜帰宅の外にあります')
    }
    onlineSeconds = unionSeconds(onlineSpans)
  } else if (session.summaryOnlineSeconds != null) {
    onlineSeconds = session.summaryOnlineSeconds
    if (hours !== null && onlineSeconds > hours * 3600) errors.push('オンライン時間が拘束時間より長いです')
  }
  let activeSeconds: number | null = null
  const deliverySpans = (session.deliveries ?? [])
    .filter((d) => d.acceptedAt && d.completedAt)
    .map((d) => toSpan(d.acceptedAt as string, d.completedAt as string, '配達'))
  if (deliverySpans.length > 0) {
    if (onlineSpans.length > 0 && !isCovered(deliverySpans, onlineSpans)) {
      errors.push('オンライン外の配達があります（自動では直しません）')
    }
    activeSeconds = unionSeconds(deliverySpans)
  }

  // 費用 C
  let rentalYen: number | null = 0
  for (const rental of session.rentals ?? []) {
    const r = calculateRental(rental, context.asOf)
    if (r.amountYen === null) {
      rentalYen = null
      errors.push(r.reason ?? 'レンタル料金を算出できません。実請求額を入力してください')
    } else if (rentalYen !== null) {
      rentalYen += r.amountYen
    }
  }
  let directExpenseYen = 0
  for (const e of session.directExpensesYen ?? []) {
    assertYen(e, '経費')
    directExpenseYen += e
  }
  const costYen = rentalYen === null ? null : rentalYen + directExpenseYen + fixedCostYen
  const operatingProfitYen = costYen === null ? null : revenueYen - costYen
  const afterAllocationProfitYen =
    operatingProfitYen === null ? null : operatingProfitYen - allocatedInvestmentYen

  const onlineHours = onlineSeconds === null ? null : onlineSeconds / 3600
  const activeHours = activeSeconds === null ? null : activeSeconds / 3600
  const per = (value: number | null, denominator: number | null) =>
    value === null || denominator === null ? null : divide(value, denominator)

  return {
    currency: CURRENCY,
    calculationVersion: CALCULATION_VERSION,
    valid: errors.length === 0 && session.status === 'completed' && hours !== null,
    revenueYen,
    deliveryRevenueYen,
    adjustmentYen,
    rentalYen,
    directExpenseYen,
    fixedCostYen,
    costYen,
    operatingProfitYen,
    allocatedInvestmentYen,
    afterAllocationProfitYen,
    hours,
    onlineHours,
    activeHours,
    hourlyYen: per(operatingProfitYen, hours),
    afterAllocationHourlyYen: per(afterAllocationProfitYen, hours),
    onlineRevenueHourlyYen: per(revenueYen, onlineHours),
    activeRevenueHourlyYen: session.revenueMode === 'detail' ? per(deliveryRevenueYen, activeHours) : null,
    idleRate:
      onlineHours === null || activeHours === null ? null : divide(onlineHours - activeHours, onlineHours),
    completedCount,
    profitPerDeliveryYen: per(operatingProfitYen, completedCount),
    rentalCostRate: per(rentalYen, revenueYen),
    errors,
    warnings,
  }
}
