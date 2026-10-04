// 続けるか帰るか（受入 A16・A17）
import { describe, expect, it } from 'vitest'
import { HELLO_TOKYO_CITY, evaluateContinuation, type ContinuationInput } from './index'

const base = (over: Partial<ContinuationInput> = {}): ContinuationInput => ({
  now: '2026-10-05T11:00:00Z', // 20:00 JST
  departedAt: '2026-10-05T08:00:00Z', // 17:00 JST
  extendMinutes: 30,
  extraRevenueYen: { pessimistic: 600, standard: 600, optimistic: 600 },
  rental: null,
  targetHourlyYen: 1500,
  ...over,
})

describe('A16 追加の時給と目標', () => {
  it('目標1500・追加利益600・追加0.5時間 → 追加時給1200。楽観も同じなら STOP', () => {
    const r = evaluateContinuation(base())
    expect(r.deltaHours).toBe(0.5)
    expect(r.hourlyYen.standard).toBe(1200)
    expect(r.decision).toBe('STOP')
    expect(r.reasons.join()).toContain('楽観')
  })

  it('悲観でも目標以上なら GO、見込みで判定が変わるなら WAIT', () => {
    expect(evaluateContinuation(base({ extraRevenueYen: { pessimistic: 800, standard: 900, optimistic: 1000 } })).decision).toBe('GO')
    expect(evaluateContinuation(base({ extraRevenueYen: { pessimistic: 500, standard: 800, optimistic: 1000 } })).decision).toBe('WAIT')
  })
})

describe('A17 締切と料金', () => {
  it('延長すると帰宅締切を過ぎるなら、見込みが良くても STOP', () => {
    const r = evaluateContinuation(base({ homeDeadline: '20:30', minutesToHome: 15, extraRevenueYen: { pessimistic: 3000, standard: 3000, optimistic: 3000 } }))
    expect(r.decision).toBe('STOP')
    expect(r.reasons[0]).toContain('締切')
  })

  it('深夜の締切は翌日として扱う（01:00締切で20:30帰宅は締切内）', () => {
    const r = evaluateContinuation(base({ homeDeadline: '01:00', extraRevenueYen: { pessimistic: 1000, standard: 1000, optimistic: 1000 } }))
    expect(r.decision).toBe('GO')
  })

  it('料金が見積の対象外なら WAIT と理由（推定で埋めない）', () => {
    const r = evaluateContinuation(base({ rental: { tariff: HELLO_TOKYO_CITY, startAt: '2026-10-04T23:10:00Z' } })) // 約11時間50分経過
    expect(r.extraRentalYen).toBeNull()
    expect(r.decision).toBe('WAIT')
    expect(r.reasons.join()).toContain('料金')
  })
})

describe('追加レンタル', () => {
  it('今返す場合との差だけを引く（すでに払う分は引かない）', () => {
    // 貸出から1時間。返却まで10分 → 今やめても1:10で640円、30分延長だと1:40で960円 → 差320円
    const r = evaluateContinuation(base({ rental: { tariff: HELLO_TOKYO_CITY, startAt: '2026-10-05T10:00:00Z' }, minutesToReturnBike: 10 }))
    expect(r.extraRentalYen).toBe(320)
    expect(r.deltaProfitYen.standard).toBe(600 - 320)
  })

  it('上限料金に達していれば延長しても追加レンタルは0円', () => {
    const r = evaluateContinuation(base({ rental: { tariff: HELLO_TOKYO_CITY, startAt: '2026-10-05T05:00:00Z' } })) // 6時間経過
    expect(r.extraRentalYen).toBe(0)
  })

  it('目標未設定・見込み未入力・延長0分は WAIT', () => {
    expect(evaluateContinuation(base({ targetHourlyYen: null })).decision).toBe('WAIT')
    expect(evaluateContinuation(base({ extraRevenueYen: { pessimistic: null, standard: 600, optimistic: 600 } })).decision).toBe('WAIT')
    const zero = evaluateContinuation(base({ extendMinutes: 0 }))
    expect(zero.decision).toBe('WAIT')
    expect(zero.hourlyYen.standard).toBeNull()
  })
})
