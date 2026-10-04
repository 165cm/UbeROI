// 期間（日・週・月・任意）の損益（docs/spec/docs/02-profitability.md §2・§4）
import {
  CALCULATION_VERSION,
  CURRENCY,
  allocateByWeight,
  assertYen,
  divide,
  lastDayOfMonth,
  localDate,
  monthRange,
} from './core'
import { allocationForMonth, type AssetInput } from './investment'
import { calculateSession, type SessionInput, type SessionResult } from './session'

export interface MonthlyExpenseInput {
  /** 対象月 YYYY-MM */
  month: string
  amountYen: number
}

export interface PeriodInput {
  /** 日本時間の日付（両端を含む） */
  from: string
  to: string
  sessions: readonly (SessionInput & { id: string })[]
  monthlyExpenses?: readonly MonthlyExpenseInput[]
  assets?: readonly AssetInput[]
}

export interface PeriodSessionRow {
  id: string
  localDate: string
  result: SessionResult
}

export interface PeriodTotals {
  revenueYen: number
  rentalYen: number
  directExpenseYen: number
  fixedCostYen: number
  costYen: number
  operatingProfitYen: number
  allocatedInvestmentYen: number
  afterAllocationProfitYen: number
  hours: number
  completedCount: number
  /** 平均時給＝総利益÷総拘束時間（個別時給の平均ではない） */
  hourlyYen: number | null
  afterAllocationHourlyYen: number | null
}

export interface PeriodResult {
  currency: typeof CURRENCY
  calculationVersion: number
  totals: PeriodTotals
  rows: PeriodSessionRow[]
  /** 稼働がなく、どの稼働にも配れなかった固定費（期間の損益には含める） */
  unallocatedFixedCostsYen: number
  unallocatedInvestmentYen: number
  /** 帰宅未記録・稼働中で、確定集計から外した件数 */
  excludedDrafts: number
  /** 入力エラーで確定集計から外した件数 */
  excludedInvalid: number
  /** 期間が月の一部だけのため含めなかった、稼働のない月の固定費・配賦 */
  partialMonthsNote: string[]
}

/**
 * 月の固定費・配賦額は、その月に帰宅した確定稼働へ拘束時間の比で配る。
 * 稼働のない月の額は、期間がその月を丸ごと含む時だけ損益に入れる。
 */
export function calculatePeriod(input: PeriodInput): PeriodResult {
  const monthlyExpenses = input.monthlyExpenses ?? []
  const assets = input.assets ?? []
  for (const e of monthlyExpenses) assertYen(e.amountYen, '月額の経費')

  let excludedDrafts = 0
  let excludedInvalid = 0
  const candidates: { id: string; session: SessionInput; date: string; hours: number }[] = []
  for (const s of input.sessions) {
    if (s.status !== 'completed' || !s.returnedAt) {
      excludedDrafts++
      continue
    }
    const base = calculateSession(s)
    if (!base.valid || base.hours === null) {
      excludedInvalid++
      continue
    }
    candidates.push({ id: s.id, session: s, date: localDate(s.returnedAt), hours: base.hours })
  }

  const months = monthRange(input.from.slice(0, 7), input.to.slice(0, 7))
  const rows: PeriodSessionRow[] = []
  let unallocatedFixedCostsYen = 0
  let unallocatedInvestmentYen = 0
  const partialMonthsNote: string[] = []

  for (const month of months) {
    const inMonth = candidates.filter((c) => c.date.startsWith(month))
    const fixedTotal = monthlyExpenses.filter((e) => e.month === month).reduce((a, e) => a + e.amountYen, 0)
    const investmentTotal = allocationForMonth(assets, month)
    const weights = inMonth.map((c) => c.hours)
    const fixedShares = allocateByWeight(fixedTotal, weights)
    const investmentShares = allocateByWeight(investmentTotal, weights)

    if (inMonth.length === 0) {
      const coversWholeMonth = input.from <= `${month}-01` && lastDayOfMonth(month) <= input.to
      if (coversWholeMonth) {
        unallocatedFixedCostsYen += fixedTotal
        unallocatedInvestmentYen += investmentTotal
      } else if (fixedTotal !== 0 || investmentTotal !== 0) {
        partialMonthsNote.push(month)
      }
      continue
    }
    inMonth.forEach((c, i) => {
      if (c.date < input.from || c.date > input.to) return
      rows.push({
        id: c.id,
        localDate: c.date,
        result: calculateSession(c.session, {
          fixedCostYen: fixedShares?.[i] ?? 0,
          allocatedInvestmentYen: investmentShares?.[i] ?? 0,
        }),
      })
    })
  }

  const sum = (pick: (r: SessionResult) => number | null) =>
    rows.reduce((acc, row) => acc + (pick(row.result) ?? 0), 0)
  const revenueYen = sum((r) => r.revenueYen)
  const rentalYen = sum((r) => r.rentalYen)
  const directExpenseYen = sum((r) => r.directExpenseYen)
  const fixedCostYen = sum((r) => r.fixedCostYen) + unallocatedFixedCostsYen
  const costYen = rentalYen + directExpenseYen + fixedCostYen
  const operatingProfitYen = revenueYen - costYen
  const allocatedInvestmentYen = sum((r) => r.allocatedInvestmentYen) + unallocatedInvestmentYen
  const afterAllocationProfitYen = operatingProfitYen - allocatedInvestmentYen
  const hours = sum((r) => r.hours)

  return {
    currency: CURRENCY,
    calculationVersion: CALCULATION_VERSION,
    totals: {
      revenueYen,
      rentalYen,
      directExpenseYen,
      fixedCostYen,
      costYen,
      operatingProfitYen,
      allocatedInvestmentYen,
      afterAllocationProfitYen,
      hours,
      completedCount: sum((r) => r.completedCount),
      hourlyYen: divide(operatingProfitYen, hours),
      afterAllocationHourlyYen: divide(afterAllocationProfitYen, hours),
    },
    rows,
    unallocatedFixedCostsYen,
    unallocatedInvestmentYen,
    excludedDrafts,
    excludedInvalid,
    partialMonthsNote,
  }
}
