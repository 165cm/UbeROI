// 保存データ → 計算関数の入力。計算そのものは src/domain に任せる
import {
  assetCashEvents,
  calculatePeriod,
  calculateRecovery,
  calculateSession,
  localDate,
  monthRange,
  type AssetInput,
  type CashEvent,
  type MonthlyExpenseInput,
  type PeriodResult,
  type RecoveryResult,
  type SessionInput,
} from '../domain'
import type { AssetRecord, RecurringExpenseRecord, SessionRecord } from './schema'

export function sessionToInput(s: SessionRecord): SessionInput & { id: string } {
  return {
    id: s.id,
    status: s.status,
    departedAt: s.departedAt,
    returnedAt: s.returnedAt,
    platform: s.platform,
    revenueMode: s.revenueMode,
    baseYen: s.baseYen,
    tipsYen: s.tipsYen,
    completedCount: s.completedCount,
    adjustments: s.adjustments,
    summaryOnlineSeconds: s.summaryOnlineSeconds,
    rentals: s.rentals.map((r) => ({ tariff: r.tariff, startAt: r.startAt, endAt: r.endAt, billedYen: r.billedYen })),
    directExpensesYen: s.directExpenses.map((e) => e.amountYen),
  }
}

export function assetToInput(a: AssetRecord): AssetInput {
  return {
    id: a.id,
    status: a.status,
    purchasedAt: a.purchasedAt,
    inServiceMonth: a.inServiceMonth,
    unitYen: a.unitYen,
    quantity: a.quantity,
    businessRatioBps: a.businessRatioBps,
    managementValueYen: a.managementValueYen,
    residualYen: a.residualYen,
    lifetimeMonths: a.lifetimeMonths,
    soldAt: a.soldAt,
    businessSaleYen: a.businessSaleYen,
  }
}

/** 毎月の固定費を、対象の月ごとの金額に展開する */
export function expandRecurring(records: readonly RecurringExpenseRecord[], fromMonth: string, toMonth: string): MonthlyExpenseInput[] {
  const out: MonthlyExpenseInput[] = []
  for (const r of records) {
    const start = r.startMonth > fromMonth ? r.startMonth : fromMonth
    const end = r.endMonth && r.endMonth < toMonth ? r.endMonth : toMonth
    if (start > end) continue
    for (const month of monthRange(start, end)) out.push({ month, amountYen: r.amountYen })
  }
  return out
}

export interface DataSnapshot {
  sessions: SessionRecord[]
  recurringExpenses: RecurringExpenseRecord[]
  assets: AssetRecord[]
}

export function periodFor(data: DataSnapshot, from: string, to: string): PeriodResult {
  return calculatePeriod({
    from,
    to,
    sessions: data.sessions.map(sessionToInput),
    monthlyExpenses: expandRecurring(data.recurringExpenses, from.slice(0, 7), to.slice(0, 7)),
    assets: data.assets.map(assetToInput),
  })
}

/**
 * 現金ベースの投資回収。確定した稼働の売上・レンタル・経費は帰宅日、
 * 固定費は各月1日、装備は購入日・売却日に計上する。
 */
export function recoveryFor(data: DataSnapshot, asOf: string): RecoveryResult {
  return calculateRecovery(cashEventsFor(data, asOf), asOf)
}

/** 現金の出入り（投資回収と、その推移のグラフに使う） */
export function cashEventsFor(data: DataSnapshot, asOf: string): CashEvent[] {
  const events: CashEvent[] = []
  for (const s of data.sessions) {
    if (s.status !== 'completed' || !s.returnedAt) continue
    const r = calculateSession(sessionToInput(s))
    if (!r.valid || r.rentalYen === null) continue
    events.push({ at: s.returnedAt, kind: 'revenue', amountYen: r.revenueYen })
    events.push({ at: s.returnedAt, kind: 'rental', amountYen: r.rentalYen })
    events.push({ at: s.returnedAt, kind: 'expense', amountYen: r.directExpenseYen })
  }
  const asOfMonth = localDate(asOf).slice(0, 7)
  const firstMonth = data.recurringExpenses.reduce((m, r) => (r.startMonth < m ? r.startMonth : m), asOfMonth)
  for (const m of expandRecurring(data.recurringExpenses, firstMonth, asOfMonth)) {
    events.push({ at: `${m.month}-01T00:00:00+09:00`, kind: 'expense', amountYen: m.amountYen })
  }
  for (const a of data.assets) events.push(...assetCashEvents(assetToInput(a)))
  const cutoff = Date.parse(asOf)
  return events.filter((e) => Date.parse(e.at) <= cutoff)
}
