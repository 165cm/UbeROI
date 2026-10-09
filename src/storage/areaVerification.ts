import type { AreaRecord } from './schema'

/** 旧版は全体の確認日を、入力済みの曜日に引き継ぐ。 */
export function areaDayDates(area: AreaRecord): (string | null)[] {
  return area.checkedByDay ?? area.levels.map(row => row.some(v => v > 0) ? area.checkedAt : null)
}

/** 全体の鮮度表示は最も古い確認日。1曜日の更新で他の曜日まで新しく見せない。 */
export function markAreaDays(area: AreaRecord, days: number[], date: string): AreaRecord {
  const checkedByDay = areaDayDates(area).map((old, d) => days.includes(d) ? date : old)
  const dates = checkedByDay.filter((v): v is string => v !== null).sort()
  return { ...area, checkedByDay, checkedAt: dates[0] ?? date }
}
