// 装備・車両の投資：管理配賦と現金回収（docs/spec/docs/02-profitability.md §4）
import { CALCULATION_VERSION, CURRENCY, addMonths, assertYen, divide, localMonth } from './core'

export interface AssetInput {
  id: string
  /** owned＝前から持っていた物（今回の現金支出0）、purchased＝今回買った物 */
  status: 'owned' | 'purchased'
  purchasedAt?: string | null
  /** 利用開始月 YYYY-MM */
  inServiceMonth: string
  unitYen: number
  quantity: number
  /** 業務使用割合（0〜10000 = 0〜100%） */
  businessRatioBps: number
  /** 前から持っていた物の管理用価値（任意） */
  managementValueYen?: number | null
  residualYen: number
  lifetimeMonths: number
  soldAt?: string | null
  businessSaleYen?: number | null
}

function validateAsset(a: AssetInput): void {
  assertYen(a.unitYen, '単価')
  assertYen(a.residualYen, '残存額')
  if (!Number.isInteger(a.quantity) || a.quantity < 1) throw new RangeError('数量は1以上です')
  if (!Number.isInteger(a.lifetimeMonths) || a.lifetimeMonths < 1) throw new RangeError('配賦期間は1か月以上です')
  if (!Number.isInteger(a.businessRatioBps) || a.businessRatioBps < 0 || a.businessRatioBps > 10000) {
    throw new RangeError('業務使用割合は0〜100%です')
  }
  if (a.status === 'purchased' && !a.purchasedAt) throw new RangeError('購入済みの装備には購入日が必要です')
}

/** 今回の現金投資 Ii（購入済みのみ。業務使用割合を1回だけ掛ける） */
export function cashInvestmentYen(a: AssetInput): number {
  validateAsset(a)
  if (a.status !== 'purchased') return 0
  return Math.round((a.unitYen * a.quantity * a.businessRatioBps) / 10000)
}

/** 管理対象価値（配賦のもとになる額） */
export function managementValueYen(a: AssetInput): number {
  if (a.status === 'purchased') return cashInvestmentYen(a)
  validateAsset(a)
  const v = a.managementValueYen ?? 0
  assertYen(v, '管理用価値')
  return v
}

/**
 * 月ごとの配賦額。利用開始月から N か月で均等（初月の日割りなし）、端数は最後の月。
 * 売却した月で残りをまとめて計上し、翌月以降は配賦しない。
 */
export function allocationSchedule(a: AssetInput): Map<string, number> {
  const value = managementValueYen(a)
  if (a.residualYen > value) throw new RangeError('残存額は管理対象価値以下にしてください')
  const total = value - a.residualYen
  const base = Math.floor(total / a.lifetimeMonths)
  const schedule = new Map<string, number>()
  for (let i = 0; i < a.lifetimeMonths; i++) {
    const amount = i === a.lifetimeMonths - 1 ? total - base * (a.lifetimeMonths - 1) : base
    schedule.set(addMonths(a.inServiceMonth, i), amount)
  }
  if (a.soldAt) {
    const soldMonth = localMonth(a.soldAt)
    let carried = 0
    for (const [month, amount] of [...schedule]) {
      if (month > soldMonth) {
        carried += amount
        schedule.delete(month)
      }
    }
    if (carried > 0) schedule.set(soldMonth, (schedule.get(soldMonth) ?? 0) + carried)
  }
  return schedule
}

/** ある月の配賦額の合計 */
export function allocationForMonth(assets: readonly AssetInput[], month: string): number {
  return assets.reduce((sum, a) => sum + (allocationSchedule(a).get(month) ?? 0), 0)
}

export interface CashEvent {
  /** ISO 日時（支払日・入金日） */
  at: string
  kind: 'revenue' | 'rental' | 'expense' | 'investment' | 'sale'
  /** revenue/sale は入る額、それ以外は出る額。いずれも正の整数円（調整のみ負を許可） */
  amountYen: number
}

/** 装備の購入・売却を現金の出入りに変換する（予定の装備は含めない） */
export function assetCashEvents(a: AssetInput): CashEvent[] {
  const events: CashEvent[] = []
  const invested = cashInvestmentYen(a)
  if (invested > 0 && a.purchasedAt) events.push({ at: a.purchasedAt, kind: 'investment', amountYen: invested })
  if (a.soldAt && a.businessSaleYen != null) {
    assertYen(a.businessSaleYen, '売却額')
    events.push({ at: a.soldAt, kind: 'sale', amountYen: a.businessSaleYen })
  }
  return events
}

export interface RecoveryResult {
  currency: typeof CURRENCY
  calculationVersion: number
  investedYen: number
  /** 現金ベースの累積営業余剰 G */
  cashSurplusYen: number
  saleYen: number
  /** 投資込み累積キャッシュ G − I + 売却 */
  netCashYen: number
  remainingYen: number
  /** 回収率（0.174 = 17.4%）。投資0なら null */
  recoveryRate: number | null
  roi: number | null
}

export function calculateRecovery(events: readonly CashEvent[], asOf?: string): RecoveryResult {
  const cutoff = asOf ? Date.parse(asOf) : Infinity
  let revenue = 0
  let outflow = 0
  let invested = 0
  let sale = 0
  for (const e of events) {
    if (Date.parse(e.at) > cutoff) continue
    assertYen(e.amountYen, '現金の出入り', { allowNegative: e.kind === 'revenue' })
    if (e.kind === 'revenue') revenue += e.amountYen
    else if (e.kind === 'rental' || e.kind === 'expense') outflow += e.amountYen
    else if (e.kind === 'investment') invested += e.amountYen
    else sale += e.amountYen
  }
  const surplus = revenue - outflow
  return {
    currency: CURRENCY,
    calculationVersion: CALCULATION_VERSION,
    investedYen: invested,
    cashSurplusYen: surplus,
    saleYen: sale,
    netCashYen: surplus - invested + sale,
    remainingYen: Math.max(0, invested - surplus - sale),
    recoveryRate: divide(surplus + sale, invested),
    roi: divide(surplus + sale - invested, invested),
  }
}

/** 予測の回収月数。月の余剰が0以下なら null（回収見込みなし）。端数月はそのまま */
export function forecastRecoveryMonths(remainingYen: number, monthlySurplusYen: number): number | null {
  if (remainingYen === 0) return 0
  if (monthlySurplusYen <= 0) return null
  return remainingYen / monthlySurplusYen
}
