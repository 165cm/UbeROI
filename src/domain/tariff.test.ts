// レンタル料金：段階料金の上限の使い方
import { describe, expect, it } from 'vitest'
import { HELLO_TOKYO_CITY, feeFor, rentalCostByHours, tieredCapInfo } from './index'

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
})
