// お釣り計算
import { describe, expect, it } from 'vitest'
import { calculateChange, changeBreakdown, likelyPayments } from './index'

describe('お釣り', () => {
  it('受け取った額からお釣りと渡し方を出す', () => {
    expect(calculateChange(4260, 5300)).toEqual({
      receivedYen: 5300,
      changeYen: 1040,
      shortYen: 0,
      breakdown: [
        { yen: 1000, count: 1 },
        { yen: 10, count: 4 },
      ],
    })
    expect(changeBreakdown(8765)).toEqual([
      { yen: 5000, count: 1 },
      { yen: 1000, count: 3 },
      { yen: 500, count: 1 },
      { yen: 100, count: 2 },
      { yen: 50, count: 1 },
      { yen: 10, count: 1 },
      { yen: 5, count: 1 },
    ])
  })

  it('足りない時はお釣りを出さず、足りない額を出す。ちょうどならお釣り0円', () => {
    expect(calculateChange(4260, 4000)).toMatchObject({ changeYen: null, shortYen: 260, breakdown: [] })
    expect(calculateChange(4260, 4260)).toMatchObject({ changeYen: 0, shortYen: 0, breakdown: [] })
  })

  it('出されそうな額を小さい順に、重ならないように並べる', () => {
    // ちょうど・100円単位・500円単位・1000円単位・小銭を足してお札だけのお釣り・5000円・1万円
    expect(likelyPayments(4260)).toEqual([4260, 4300, 4500, 5000, 5260, 10000])
    expect(likelyPayments(1950)).toEqual([1950, 2000, 2950, 5000, 10000])
    expect(likelyPayments(3000)).toEqual([3000, 5000, 10000])
    expect(likelyPayments(12340)).toEqual([12340, 12400, 12500, 13000, 13340, 15000, 20000])
    expect(likelyPayments(0)).toEqual([])
  })

  it('とても大きな額でも、切り上げで安全な整数を超える候補は出さない（画面が止まらない）', () => {
    const max = Number.MAX_SAFE_INTEGER
    const list = likelyPayments(max)
    expect(list).toEqual([max])
    for (const paid of list) expect(() => calculateChange(max, paid)).not.toThrow()
  })

  it('負の額・小数は受け付けない', () => {
    expect(() => calculateChange(-1, 100)).toThrow()
    expect(() => likelyPayments(10.5)).toThrow()
  })
})
