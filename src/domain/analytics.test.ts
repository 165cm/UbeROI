import { describe, expect, it } from 'vitest'
import {
  breakdown,
  calculateRecovery,
  csvCell,
  periodRange,
  recoverySeries,
  shiftPeriod,
  timeSlotOf,
  toCsv,
  weekdayOf,
  type CashEvent,
} from './index'

describe('期間の区切り（A27）', () => {
  it('週は月曜始まり、月・年は暦どおり', () => {
    expect(periodRange('week', '2026-11-01')).toEqual({ from: '2026-10-26', to: '2026-11-01' })
    expect(periodRange('month', '2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(periodRange('year', '2026-10-04')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(shiftPeriod('month', '2026-12-15', 1)).toBe('2027-01-01')
    expect(shiftPeriod('week', '2026-10-26', -1)).toBe('2026-10-19')
  })

  it('時間帯と曜日は日本時間で決める', () => {
    expect(timeSlotOf('2026-10-04T09:00:00Z')).toBe('dinner') // 18:00 JST
    expect(timeSlotOf('2026-10-04T02:30:00Z')).toBe('lunch') // 11:30 JST
    expect(timeSlotOf('2026-10-04T16:00:00Z')).toBe('night') // 翌1:00 JST
    expect(weekdayOf('2026-10-04T16:00:00Z')).toBe('月')
  })
})

describe('内訳', () => {
  it('グループの時給は総利益÷総時間。件数が少ないものに印をつける', () => {
    const rows = breakdown(
      [
        { w: 'rain', h: 1, p: 1000 },
        { w: 'rain', h: 3, p: 6000 },
        { w: 'clear', h: 2, p: 2000 },
      ],
      (x) => x.w,
      (x) => ({ hours: x.h, operatingProfitYen: x.p }),
    )
    expect(rows[0]).toMatchObject({ key: 'rain', count: 2, hourlyYen: 1750, lowSample: true })
    expect(rows[1]).toMatchObject({ key: 'clear', hourlyYen: 1000 })
  })
})

describe('回収の推移', () => {
  it('最後の点は calculateRecovery と一致し、同じ日はまとめる', () => {
    const events: CashEvent[] = [
      { at: '2026-10-01T03:00:00Z', kind: 'investment', amountYen: 30000 },
      { at: '2026-10-04T12:00:00Z', kind: 'revenue', amountYen: 7180 },
      { at: '2026-10-04T12:00:00Z', kind: 'rental', amountYen: 1760 },
      { at: '2026-10-04T12:00:00Z', kind: 'expense', amountYen: 200 },
    ]
    const series = recoverySeries(events)
    expect(series).toHaveLength(2)
    const last = series[series.length - 1]!
    const r = calculateRecovery(events)
    expect(last.netCashYen).toBe(r.netCashYen)
    expect(last.netCashYen).toBe(-24780)
  })
})

describe('CSV', () => {
  it('数式として実行されうる文字列をエスケープし、数値の負数はそのまま', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('@SUM')).toBe("'@SUM")
    expect(csvCell('-1+2')).toBe("'-1+2")
    expect(csvCell(-500)).toBe('-500')
    expect(csvCell('雨, 夜')).toBe('"雨, 夜"')
    expect(toCsv(['a', 'b'], [[1, null]])).toBe('a,b\r\n1,\r\n')
  })
})
