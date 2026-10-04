// 受入基準 docs/spec/docs/07-acceptance.md と fixtures の値で計算を確かめる
import { describe, expect, it } from 'vitest'
import cases from '../../docs/spec/fixtures/calculation-cases.json'
import {
  HELLO_TOKYO_CITY,
  allocateByWeight,
  allocationSchedule,
  assetCashEvents,
  calculatePeriod,
  calculateRecovery,
  calculateRental,
  calculateSession,
  cashInvestmentYen,
  forecastRecoveryMonths,
  localDate,
  parseInstant,
  passFee,
  summarizePlan,
  tieredFee,
  weekStart,
  type AssetInput,
  type SessionInput,
} from './index'

const START = '2026-10-04T09:00:00Z'
const after = (seconds: number) => new Date(Date.parse(START) + seconds * 1000).toISOString()

/** fixtures の稼働（18:00〜21:00 JST、レンタル3時間） */
function fixtureSession(overrides: Partial<SessionInput> = {}): SessionInput {
  const s = cases.session
  return {
    status: 'completed',
    departedAt: s.departed_at,
    returnedAt: s.returned_at,
    revenueMode: 'summary',
    baseYen: s.base_yen,
    tipsYen: s.tips_yen,
    completedCount: s.completed_count,
    adjustments: [{ id: 'quest-1', kind: 'quest', amountYen: s.bonus_yen }],
    summaryOnlineSeconds: s.online_seconds,
    rentals: [{ tariff: HELLO_TOKYO_CITY, startAt: s.departed_at, endAt: after(s.rental_seconds) }],
    directExpensesYen: [s.direct_expense_yen],
    ...overrides,
  }
}

describe('A01・A02 稼働1回の収益（fixtures）', () => {
  const expected = cases.session.expected

  it('A01 営業純利益5220円・時給1740円・売上時給2872円', () => {
    const r = calculateSession(fixtureSession())
    expect(r.valid).toBe(true)
    expect(r.revenueYen).toBe(expected.revenue_yen)
    expect(r.rentalYen).toBe(1760)
    expect(r.operatingProfitYen).toBe(expected.operating_profit_yen)
    expect(r.hourlyYen).toBe(expected.operating_hourly_yen)
    expect(r.onlineRevenueHourlyYen).toBe(expected.online_revenue_hourly_yen)
  })

  it('A02 配賦600円で配賦後4620円・1540円/時。購入額は引かない', () => {
    const r = calculateSession(fixtureSession(), { allocatedInvestmentYen: cases.session.allocated_investment_yen })
    expect(r.operatingProfitYen).toBe(5220)
    expect(r.afterAllocationProfitYen).toBe(expected.after_allocation_profit_yen)
    expect(r.afterAllocationHourlyYen).toBe(expected.after_allocation_hourly_yen)
  })

  it('その他経費がなければ P=5420（丸め誤差ではない）', () => {
    const r = calculateSession(fixtureSession({ directExpensesYen: [] }))
    expect(r.operatingProfitYen).toBe(5420)
    expect(r.hourlyYen).toBeCloseTo(1806.67, 2)
  })
})

describe('A03 投資回収', () => {
  it('投資30000・余剰5220 → 残24780・回収率17.4%・ROI -82.6%', () => {
    const rc = cases.recovery
    const r = calculateRecovery([
      { at: '2026-10-01T00:00:00Z', kind: 'investment', amountYen: rc.investment_yen },
      { at: '2026-10-04T12:00:00Z', kind: 'revenue', amountYen: rc.cash_surplus_yen },
    ])
    expect(r.remainingYen).toBe(rc.expected_remaining_yen)
    expect(r.recoveryRate! * 100).toBeCloseTo(rc.expected_recovery_percent, 10)
    expect(r.roi! * 100).toBeCloseTo(rc.expected_roi_percent, 10)
  })

  it('投資0なら回収率・ROIは null', () => {
    const r = calculateRecovery([{ at: START, kind: 'revenue', amountYen: 1000 }])
    expect(r.recoveryRate).toBeNull()
    expect(r.roi).toBeNull()
  })

  it('回収見込み：余剰が0以下なら null、端数月を保持', () => {
    expect(forecastRecoveryMonths(24780, 0)).toBeNull()
    expect(forecastRecoveryMonths(24780, -100)).toBeNull()
    expect(forecastRecoveryMonths(24780, 10000)).toBeCloseTo(2.478, 10)
  })
})

describe('A04・A05 HELLO 段階料金', () => {
  it.each(cases.tariff_boundaries)('$seconds 秒 → $expected_yen 円', ({ seconds, expected_yen }) => {
    expect(tieredFee(HELLO_TOKYO_CITY, seconds)).toBe(expected_yen)
  })

  it('次の課金：30分ちょうどは160円、次は30分1秒', () => {
    const r = calculateRental({ tariff: HELLO_TOKYO_CITY, startAt: START }, after(1800))
    expect(r.amountYen).toBe(160)
    expect(r.nextIncreaseAt).toBe(after(1801))
    const r2 = calculateRental({ tariff: HELLO_TOKYO_CITY, startAt: START }, after(1801))
    expect(r2.nextIncreaseAt).toBe(after(2701))
  })

  it('上限到達後は「追加課金なし」（次の課金なし・capped）', () => {
    const r = calculateRental({ tariff: HELLO_TOKYO_CITY, startAt: START }, after(14401))
    expect(r.amountYen).toBe(2500)
    expect(r.capped).toBe(true)
    expect(r.nextIncreaseAt).toBeNull()
  })

  it('720分超は対象外（実請求額を入力）', () => {
    const r = calculateRental({ tariff: HELLO_TOKYO_CITY, startAt: START, endAt: after(43201) })
    expect(r.status).toBe('unsupported')
    expect(r.amountYen).toBeNull()
  })
})

describe('A06 開始前・0秒・実請求0円', () => {
  it('開始前は0円、開始済み0秒は160円、実請求0円は0円（欠損扱いしない）', () => {
    expect(calculateRental({ tariff: HELLO_TOKYO_CITY }).amountYen).toBe(0)
    expect(calculateRental({ tariff: HELLO_TOKYO_CITY, startAt: START, endAt: START }).amountYen).toBe(160)
    const billed = calculateRental({ tariff: HELLO_TOKYO_CITY, startAt: START, endAt: after(3600), billedYen: 0 })
    expect(billed.status).toBe('actual')
    expect(billed.amountYen).toBe(0)
    expect(billed.differenceYen).toBe(-480)
  })

  it('時間パスは利用時間を満たす一番安いパス', () => {
    const t = { kind: 'pass' as const, passes: [{ minutes: 180, yen: 900 }, { minutes: 360, yen: 1500 }] }
    expect(passFee(t, 3 * 3600)).toBe(900)
    expect(passFee(t, 3 * 3600 + 1)).toBe(1500)
    expect(passFee(t, 6 * 3600 + 1)).toBeNull()
  })
})

describe('A07 0分母・不正時刻', () => {
  it('拘束時間0は確定できず、0分母の指標は null（Infinity なし）', () => {
    const r = calculateSession({
      status: 'completed',
      departedAt: START,
      returnedAt: START,
      revenueMode: 'summary',
      baseYen: 0,
      tipsYen: 0,
      completedCount: 0,
    })
    expect(r.valid).toBe(false)
    expect(r.errors.length).toBeGreaterThan(0)
    for (const v of [r.hourlyYen, r.onlineRevenueHourlyYen, r.profitPerDeliveryYen, r.rentalCostRate]) {
      expect(v).toBeNull()
    }
  })

  it('タイムゾーンのない日時・小数円・桁あふれは拒否', () => {
    expect(() => calculateSession(fixtureSession({ departedAt: '2026-10-04T18:00:00' }))).toThrow(RangeError)
    expect(() => calculateSession(fixtureSession({ baseYen: 100.5 }))).toThrow(RangeError)
    expect(() => calculateSession(fixtureSession({ baseYen: Number.MAX_SAFE_INTEGER + 1 }))).toThrow(RangeError)
  })
})

describe('A08・A09 集計の仕方', () => {
  it('A08 1h利益1000と3h利益6000 → 時給1750（単純平均1500ではない）', () => {
    const mk = (id: string, start: string, h: number, base: number) => ({
      id,
      status: 'completed' as const,
      departedAt: start,
      returnedAt: new Date(Date.parse(start) + h * 3_600_000).toISOString(),
      revenueMode: 'summary' as const,
      baseYen: base,
      tipsYen: 0,
    })
    const p = calculatePeriod({
      from: '2026-10-01',
      to: '2026-10-31',
      sessions: [mk('a', '2026-10-05T03:00:00Z', 1, 1000), mk('b', '2026-10-06T03:00:00Z', 3, 6000)],
    })
    expect(p.totals.hourlyYen).toBe(1750)
  })

  it('A09 簡易1000と詳細1000があっても採用モード分の1000だけ', () => {
    const detail = {
      deliveries: [{ id: 'd1', status: 'completed' as const, baseYen: 1000, tipYen: 0 }],
      baseYen: 1000,
      tipsYen: 0,
      adjustments: [],
    }
    expect(calculateSession(fixtureSession({ ...detail, revenueMode: 'summary' })).revenueYen).toBe(1000)
    expect(calculateSession(fixtureSession({ ...detail, revenueMode: 'detail' })).revenueYen).toBe(1000)
  })

  it('同じ明細IDのボーナスは1回だけ計上', () => {
    const r = calculateSession(
      fixtureSession({
        adjustments: [
          { id: 'q', kind: 'quest', amountYen: 400 },
          { id: 'q', kind: 'quest', amountYen: 400 },
        ],
      }),
    )
    expect(r.adjustmentYen).toBe(400)
    expect(r.warnings).toHaveLength(1)
  })
})

describe('A10 区間の和集合', () => {
  const base = fixtureSession({ summaryOnlineSeconds: null, revenueMode: 'detail', adjustments: [] })

  it('重複するオンライン・配達区間は和集合で数える', () => {
    const r = calculateSession({
      ...base,
      onlineIntervals: [
        { startAt: '2026-10-04T09:10:00Z', endAt: '2026-10-04T10:10:00Z' },
        { startAt: '2026-10-04T09:40:00Z', endAt: '2026-10-04T10:40:00Z' },
      ],
      deliveries: [
        { id: '1', status: 'completed', baseYen: 500, tipYen: 0, acceptedAt: '2026-10-04T09:15:00Z', completedAt: '2026-10-04T09:45:00Z' },
        { id: '2', status: 'completed', baseYen: 500, tipYen: 0, acceptedAt: '2026-10-04T09:30:00Z', completedAt: '2026-10-04T10:00:00Z' },
      ],
    })
    expect(r.onlineHours).toBe(1.5)
    expect(r.activeHours).toBe(0.75)
    expect(r.idleRate).toBe(0.5)
    expect(r.valid).toBe(true)
  })

  it('オンライン外の配達はエラー（強制補正しない）', () => {
    const r = calculateSession({
      ...base,
      onlineIntervals: [{ startAt: '2026-10-04T09:10:00Z', endAt: '2026-10-04T09:40:00Z' }],
      deliveries: [
        { id: '1', status: 'completed', baseYen: 500, tipYen: 0, acceptedAt: '2026-10-04T09:30:00Z', completedAt: '2026-10-04T09:50:00Z' },
      ],
    })
    expect(r.valid).toBe(false)
    expect(r.errors.join()).toContain('オンライン外')
  })
})

const purchased = (overrides: Partial<AssetInput> = {}): AssetInput => ({
  id: 'bag',
  status: 'purchased',
  purchasedAt: '2026-10-01T03:00:00Z',
  inServiceMonth: '2026-10',
  unitYen: 10000,
  quantity: 1,
  businessRatioBps: 10000,
  residualYen: 0,
  lifetimeMonths: 3,
  ...overrides,
})

describe('A11〜A13 装備プランと実績の分離', () => {
  it('A11・A13 プランを変えても、実績の回収は購入済みの装備だけで決まる', () => {
    const assets = [purchased()]
    const events = assets.flatMap(assetCashEvents)
    const before = calculateRecovery(events)
    const beginner = summarizePlan([{ label: 'バッグ', category: 'bag', unitYen: 10000, quantity: 1, state: 'purchased' }])
    const intermediate = summarizePlan([
      { label: 'バッグ', category: 'bag', unitYen: 10000, quantity: 1, state: 'purchased' },
      { label: '防水バッグ', category: 'bag', unitYen: 18000, quantity: 1, state: 'planned' },
      { label: 'ライト', category: 'visibility', unitYen: null, quantity: 1, state: 'planned' },
    ])
    expect(beginner.cashNeededYen).toBe(0)
    expect(intermediate.cashNeededYen).toBe(18000)
    expect(intermediate.unpricedCount).toBe(1)
    expect(calculateRecovery(assets.flatMap(assetCashEvents))).toEqual(before)
    expect(before.remainingYen).toBe(10000)
  })

  it('A12 前から持っている30000円の物は今回の現金投資0、配賦は管理用価値だけ', () => {
    const owned = purchased({ status: 'owned', purchasedAt: null, unitYen: 30000, managementValueYen: 12000 })
    expect(cashInvestmentYen(owned)).toBe(0)
    expect(assetCashEvents(owned)).toEqual([])
    expect([...allocationSchedule(owned).values()]).toEqual([4000, 4000, 4000])
  })

  it('業務使用割合は1回だけ掛ける', () => {
    expect(cashInvestmentYen(purchased({ businessRatioBps: 5000 }))).toBe(5000)
  })
})

describe('A14・A15 配賦と稼働のない月', () => {
  it('A14 10000円/3か月は最終月で端数調整して合計10000', () => {
    const schedule = allocationSchedule(purchased())
    expect([...schedule.entries()]).toEqual([
      ['2026-10', 3333],
      ['2026-11', 3333],
      ['2026-12', 3334],
    ])
  })

  it('売却したら翌月以降の配賦を売却月にまとめる', () => {
    const schedule = allocationSchedule(purchased({ soldAt: '2026-11-15T03:00:00Z', businessSaleYen: 2000 }))
    expect([...schedule.entries()]).toEqual([
      ['2026-10', 3333],
      ['2026-11', 6667],
    ])
  })

  it('A15 稼働0の月：月額1000・配賦500 → 営業利益-1000、配賦後-1500', () => {
    const p = calculatePeriod({
      from: '2026-11-01',
      to: '2026-11-30',
      sessions: [],
      monthlyExpenses: [{ month: '2026-11', amountYen: 1000 }],
      assets: [purchased({ unitYen: 1500 })],
    })
    expect(p.totals.operatingProfitYen).toBe(-1000)
    expect(p.totals.afterAllocationProfitYen).toBe(-1500)
    expect(p.unallocatedFixedCostsYen).toBe(1000)
  })

  it('固定費は月内の稼働へ拘束時間の比で配り、合計が一致する', () => {
    expect(allocateByWeight(1000, [1, 1, 1])).toEqual([334, 333, 333])
    expect(allocateByWeight(1000, [0, 0])).toBeNull()
  })
})

describe('A27・A30 日跨ぎ・月跨ぎ・下書き', () => {
  it('日跨ぎは帰宅日（日本時間）に集計し、週は月曜始まり', () => {
    // 10/31 23:00 JST 出発 → 11/1 01:00 JST 帰宅
    expect(localDate('2026-10-31T16:00:00Z')).toBe('2026-11-01')
    expect(weekStart('2026-11-01')).toBe('2026-10-26')
    expect(weekStart('2026-10-26')).toBe('2026-10-26')
    const s = { ...fixtureSession(), id: 'x', departedAt: '2026-10-31T14:00:00Z', returnedAt: '2026-10-31T16:00:00Z', summaryOnlineSeconds: 3600, rentals: [] }
    expect(calculatePeriod({ from: '2026-10-01', to: '2026-10-31', sessions: [s] }).rows).toHaveLength(0)
    expect(calculatePeriod({ from: '2026-11-01', to: '2026-11-30', sessions: [s] }).rows).toHaveLength(1)
  })

  it('A30 帰宅未記録は下書きとして確定集計から外し、件数を出す', () => {
    const draft = { ...fixtureSession({ status: 'draft', returnedAt: null }), id: 'd' }
    const p = calculatePeriod({ from: '2026-10-01', to: '2026-10-31', sessions: [draft] })
    expect(p.rows).toHaveLength(0)
    expect(p.excludedDrafts).toBe(1)
  })
})

describe('入力の検証（レビュー指摘）', () => {
  const base: SessionInput = {
    status: 'completed',
    departedAt: '2026-10-04T09:00:00Z',
    returnedAt: '2026-10-04T12:00:00Z',
    revenueMode: 'summary',
    baseYen: 1000,
    tipsYen: 0,
  }

  it('存在しない暦日・時刻は正規化せず拒否する', () => {
    expect(() => parseInstant('2026-02-30T00:00:00Z')).toThrow(RangeError)
    expect(() => parseInstant('2026-10-04T24:30:00+09:00')).toThrow(RangeError)
    expect(() => parseInstant('2026-10-04T09:00:00+25:00')).toThrow(RangeError)
    expect(parseInstant('2026-10-04T18:00:00+09:00')).toBe(Date.parse('2026-10-04T09:00:00Z'))
    expect(parseInstant('2026-10-04T09:00:00.500Z')).toBe(Date.parse('2026-10-04T09:00:00.500Z'))
  })

  it('負・非有限の集計オンライン時間はエラー', () => {
    expect(calculateSession({ ...base, summaryOnlineSeconds: -100 }).valid).toBe(false)
    expect(calculateSession({ ...base, summaryOnlineSeconds: Number.NaN }).valid).toBe(false)
    expect(calculateSession({ ...base, summaryOnlineSeconds: 0 }).valid).toBe(true)
  })

  it('実請求があっても、終了が開始より前のレンタルはエラー（請求額は費用に残す）', () => {
    const r = calculateSession({
      ...base,
      rentals: [{ tariff: HELLO_TOKYO_CITY, startAt: '2026-10-04T10:00:00Z', endAt: '2026-10-04T09:30:00Z', billedYen: 300 }],
    })
    expect(r.valid).toBe(false)
    expect(r.rentalYen).toBe(300)
  })

  it('期間外の下書き・不正な記録は除外件数に数えない', () => {
    const octDraft = { ...base, id: 'd', status: 'draft' as const, returnedAt: null, departedAt: '2026-10-10T09:00:00Z' }
    const octInvalid = { ...base, id: 'i', baseYen: null }
    expect(calculatePeriod({ from: '2026-11-01', to: '2026-11-30', sessions: [octDraft, octInvalid] })).toMatchObject({
      excludedDrafts: 0,
      excludedInvalid: 0,
    })
    expect(calculatePeriod({ from: '2026-10-01', to: '2026-10-31', sessions: [octDraft, octInvalid] })).toMatchObject({
      excludedDrafts: 1,
      excludedInvalid: 1,
    })
  })
})
