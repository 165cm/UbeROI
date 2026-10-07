// レンタル料金：段階料金の上限の使い方
import { describe, expect, it } from 'vitest'
import { HELLO_TOKYO_CITY, calculateRental, feeFor, nextChargeYen, rentalCostByHours, tieredCapInfo } from './index'

describe('上限の使い方（HELLO CYCLING）', () => {
  it('240分1秒で2,500円に達し、12時間までは増えない。長く乗るほど1時間あたりが下がる', () => {
    expect(tieredCapInfo(HELLO_TOKYO_CITY)).toEqual({ capYen: 2500, reachesCapAtSeconds: 14401, coversUntilSeconds: 43200 })
    expect(feeFor(HELLO_TOKYO_CITY, 14400)).toBe(2400)
    expect(feeFor(HELLO_TOKYO_CITY, 14401)).toBe(2500)
    expect(rentalCostByHours(HELLO_TOKYO_CITY, [1, 2, 4, 5, 8, 13])).toEqual([
      { hours: 1, yen: 480, perHourYen: 480 },
      { hours: 2, yen: 1120, perHourYen: 560 },
      { hours: 4, yen: 2400, perHourYen: 600 },
      { hours: 5, yen: 2500, perHourYen: 500 },
      { hours: 8, yen: 2500, perHourYen: 313 },
      { hours: 13, yen: null, perHourYen: null },
    ])
  })

  it('上限に届かない料金（加算0円・上限の時間内に届かない）は上限の案内をしない', () => {
    expect(tieredCapInfo({ ...HELLO_TOKYO_CITY, stepYen: 0 })).toBeNull()
    expect(tieredCapInfo({ ...HELLO_TOKYO_CITY, capMinutes: 200 })).toBeNull()
    expect(tieredCapInfo({ ...HELLO_TOKYO_CITY, initialYen: 3000 })).toMatchObject({ reachesCapAtSeconds: 1 })
  })
})

describe('次の課金で上がる額（表示用）', () => {
  it('次に上がる時刻の直後の料金 − 今の料金。上限に達した後・出せない時は null', () => {
    const start = '2026-10-07T09:00:00.000Z'
    const r = calculateRental({ tariff: HELLO_TOKYO_CITY, startAt: start }, '2026-10-07T09:20:00.000Z')
    expect(r.nextIncreaseAt).not.toBeNull()
    const step = nextChargeYen(HELLO_TOKYO_CITY, start, r.nextIncreaseAt, r.amountYen)
    expect(step).toBe(feeFor(HELLO_TOKYO_CITY, (Date.parse(r.nextIncreaseAt!) - Date.parse(start)) / 1000 + 1)! - r.amountYen!)
    expect(step).toBeGreaterThan(0)
    expect(nextChargeYen(HELLO_TOKYO_CITY, start, null, 500)).toBeNull()
  })
})
