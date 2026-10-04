// 計画（仕様 S05・§5、受入 A29）
import { describe, expect, it } from 'vitest'
import { estimateRevenue, evaluateSlot, planWeek, weeklyFixedCostYen, weeksToRecover, type SlotInput } from './index'

const slot = (id: string, start: string, end: string, standard: number, extra: Partial<SlotInput> = {}): SlotInput => ({
  id,
  startsAt: start,
  endsAt: end,
  revenueYen: { pessimistic: Math.round(standard * 0.8), standard, optimistic: Math.round(standard * 1.2) },
  rentalYen: 0,
  expenseYen: 0,
  ...extra,
})

describe('A29 週の組み合わせ', () => {
  it('3候補のうち2つが重なる時、両方は選ばない', () => {
    const plan = planWeek(
      [
        slot('a', '2026-10-05T08:00:00Z', '2026-10-05T11:00:00Z', 5000), // 17〜20時 JST
        slot('b', '2026-10-05T10:00:00Z', '2026-10-05T12:00:00Z', 4000), // aと重なる
        slot('c', '2026-10-06T08:00:00Z', '2026-10-06T10:00:00Z', 3000),
      ],
      null,
    )
    expect(plan.chosenIds).toEqual(['a', 'c'])
    expect(plan.skipped).toEqual([{ id: 'b', reason: 'overlap_or_budget' }])
  })

  it('週の時間の上限を守り、時給順ではなく合計利益が最大の組み合わせを選ぶ', () => {
    // 上限4時間。時給順だと x(2h,4000 → 2000/h) を先に取り、残り2hに y(4h)が入らず z(2h,2600)で合計6600。
    // 最適は y(4h,7200 → 1800/h) だけで7200。
    const slots = [
      slot('x', '2026-10-05T03:00:00Z', '2026-10-05T05:00:00Z', 4000),
      slot('y', '2026-10-06T08:00:00Z', '2026-10-06T12:00:00Z', 7200),
      slot('z', '2026-10-07T08:00:00Z', '2026-10-07T10:00:00Z', 2600),
    ]
    const plan = planWeek(slots, 240)
    expect(plan.totalHours).toBeLessThanOrEqual(4)
    expect(plan.chosenIds).toEqual(['y'])
    expect(plan.profitYen.standard).toBe(7200)
  })

  it('赤字・締切超え・見込み未入力の枠は選ばない', () => {
    const plan = planWeek(
      [
        slot('loss', '2026-10-05T05:00:00Z', '2026-10-05T07:00:00Z', 1000, { rentalYen: 1120 }),
        slot('late', '2026-10-05T12:00:00Z', '2026-10-05T14:00:00Z', 4000, { homeDeadline: '22:00' }), // 帰宅23時 JST
        slot('blank', '2026-10-06T03:00:00Z', '2026-10-06T05:00:00Z', 0, { revenueYen: { pessimistic: null, standard: null, optimistic: null } }),
      ],
      null,
    )
    expect(plan.chosenIds).toEqual([])
    expect(plan.skipped.map((s) => s.reason)).toEqual(['not_profitable', 'past_deadline', 'missing_estimate'])
  })

  it('悲観・標準・楽観の合計と時給を横に比べられる', () => {
    const plan = planWeek([slot('a', '2026-10-05T08:00:00Z', '2026-10-05T11:00:00Z', 5000, { rentalYen: 1760 })], null)
    expect(plan.profitYen).toEqual({ pessimistic: 4000 - 1760, standard: 5000 - 1760, optimistic: 6000 - 1760 })
    expect(plan.hourlyYen.standard).toBe(1080)
  })
})

describe('売上の見込み', () => {
  it('実績が10回未満なら参考資料の推計（時間帯・月の倍率）を使い、推計と明記する', () => {
    // 10月の17〜20時（ディナー 1.20）3時間：1400 × 1.2 × 3 × 0.95
    const e = estimateRevenue('2026-10-05T08:00:00Z', '2026-10-05T11:00:00Z', [])
    expect(e.source).toBe('reference')
    expect(e.revenueYen).toBe(Math.round(1400 * 1.2 * 3 * 0.95))
    expect(e.note).toContain('推計')
  })

  it('実績が10回以上なら本人の平均、同じ時間帯が10回以上ならその平均', () => {
    const dinner = Array.from({ length: 10 }, (_, i) => ({ departedAt: `2026-09-${String(i + 10).padStart(2, '0')}T08:00:00Z`, hours: 2, revenueYen: 4000 }))
    const lunch = Array.from({ length: 10 }, (_, i) => ({ departedAt: `2026-09-${String(i + 10).padStart(2, '0')}T02:00:00Z`, hours: 2, revenueYen: 3000 }))
    expect(estimateRevenue('2026-10-05T08:00:00Z', '2026-10-05T11:00:00Z', [...dinner, ...lunch])).toMatchObject({ source: 'personal_slot', revenueYen: 6000 })
    const mixed = [...dinner.slice(0, 5), ...lunch.slice(0, 5)]
    expect(estimateRevenue('2026-10-05T08:00:00Z', '2026-10-05T11:00:00Z', mixed)).toMatchObject({ source: 'personal', revenueYen: 5250 })
  })
})

describe('装備の回収の目安', () => {
  it('価格から売上の増加を仮定せず、計画した利益で割る', () => {
    expect(weeksToRecover(18000, 6000)).toBe(3)
    expect(weeksToRecover(0, 6000)).toBe(0)
    expect(weeksToRecover(18000, 0)).toBeNull()
    expect(evaluateSlot(slot('t', '2026-10-05T08:00:00Z', '2026-10-05T08:00:00Z', 1000)).issues).toContain('invalid_time')
  })
})

describe('レビュー指摘', () => {
  it('推計は時間帯の境界で区切って積算する（13:30〜14:30 は半分ランチ・半分昼下がり）', () => {
    // 10月：1400 × (0.5h × 1.10 + 0.5h × 0.65) × 0.95
    const e = estimateRevenue('2026-10-05T04:30:00Z', '2026-10-05T05:30:00Z', [])
    expect(e.revenueYen).toBe(Math.round(1400 * (0.5 * 1.1 + 0.5 * 0.65) * 0.95))
  })

  it('締切が出発時刻より前の時刻なら翌日の締切として扱う（01:00締切・20:00〜翌0:30）', () => {
    const ok = slot('n', '2026-10-05T11:00:00Z', '2026-10-05T15:30:00Z', 5000, { homeDeadline: '01:00' })
    expect(evaluateSlot(ok).issues).not.toContain('past_deadline')
    const late = slot('m', '2026-10-05T11:00:00Z', '2026-10-05T16:30:00Z', 5000, { homeDeadline: '01:00' })
    expect(evaluateSlot(late).issues).toContain('past_deadline')
  })

  it('毎月の固定費を週の日数で按分し、計画の営業利益から差し引く', () => {
    // 10月（31日）に月3,100円 → 1日100円 × 7日 = 700円
    expect(weeklyFixedCostYen([{ month: '2026-10', amountYen: 3100 }], '2026-10-05', '2026-10-11')).toBe(700)
    // 月またぎ：9/28〜10/4（9月30日・10月31日）
    expect(weeklyFixedCostYen([{ month: '2026-09', amountYen: 3000 }, { month: '2026-10', amountYen: 3100 }], '2026-09-28', '2026-10-04')).toBe(300 + 400)
    const plan = planWeek([slot('a', '2026-10-05T08:00:00Z', '2026-10-05T11:00:00Z', 5000)], null, 'standard', 700)
    expect(plan.profitYen.standard).toBe(5000 - 700)
    expect(plan.fixedCostYen).toBe(700)
  })
})
