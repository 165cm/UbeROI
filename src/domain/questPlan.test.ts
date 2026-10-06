// クエストを軸にした週の組み立て
import { describe, expect, it } from 'vitest'
import { ordersPerHour, planQuest, type QuestPlanInput } from './index'

const jst = (s: string) => new Date(`${s}+09:00`).toISOString()

describe('1時間あたりの件数', () => {
  it('件数の入った確定記録が3回以上なら自分の平均、それまでは目安の2件', () => {
    expect(ordersPerHour([{ hours: 2, completedCount: 5 }, { hours: 3, completedCount: 7 }])).toEqual({ rate: 2, source: 'reference', samples: 2 })
    expect(ordersPerHour([{ hours: 2, completedCount: 5 }, { hours: 3, completedCount: 7 }, { hours: 3, completedCount: 8 }, { hours: 1, completedCount: null }])).toEqual({ rate: 2.5, source: 'personal', samples: 3 })
  })
})

describe('クエストの組み立て', () => {
  const base: QuestPlanInput = {
    now: jst('2026-10-06T12:00:00'),
    startsAt: jst('2026-10-05T04:00:00'),
    endsAt: jst('2026-10-09T04:00:00'),
    rewardMode: 'incremental',
    tiers: [
      { count: 10, rewardYen: 1000 },
      { count: 25, rewardYen: 1500 },
      { count: 40, rewardYen: 2500 },
    ],
    count: 6,
    // これからの計画：火曜18〜22時（4時間）・水曜18〜21時（3時間）。期間の外の枠は数えない
    slots: [
      { startsAt: jst('2026-10-06T18:00:00'), endsAt: jst('2026-10-06T22:00:00') },
      { startsAt: jst('2026-10-07T18:00:00'), endsAt: jst('2026-10-07T21:00:00') },
      { startsAt: jst('2026-10-10T18:00:00'), endsAt: jst('2026-10-10T21:00:00') },
    ],
    ordersPerHour: 2,
    revenuePerHourYen: 1400,
    costPerHourYen: 0,
    targetHourlyYen: 1500,
  }

  it('計画どおりなら第2段階まで届く。第3段階は追加の時間が要り、ボーナス込みの時給で価値を見る', () => {
    const p = planQuest(base)
    // 7時間 × 2件 = 14件 → 6 + 14 = 20件：第1段階（10件）まで。第2段階（25件）はあと5件＝2.5時間
    expect(p).toMatchObject({ plannedHours: 7, expectedCount: 20, expectedTier: 1, expectedBonusYen: 1000, hoursLeft: 64 })
    expect(p.tiers[0]).toMatchObject({ tier: 1, remaining: 4, reachedByPlan: true, extraHours: 0, extraHourlyYen: null })
    // 第2段階：追加2.5時間 → (1,400×2.5 + 1,500) ÷ 2.5 = 2,000円/時
    expect(p.tiers[1]).toMatchObject({ tier: 2, remaining: 19, reachedByPlan: false, extraHours: 2.5, extraHourlyYen: 2000, possible: true })
    // 第3段階：追加10時間 → (1,400×10 + 1,500 + 2,500) ÷ 10 = 1,800円/時
    expect(p.tiers[2]).toMatchObject({ tier: 3, extraHours: 10, extraHourlyYen: 1800 })
    expect(p.worthIt?.tier).toBe(2)
  })

  it('期間の残り時間で届かない段階は「届かない」。目標が未設定ならおすすめはしない', () => {
    const late = planQuest({ ...base, now: jst('2026-10-09T01:00:00'), slots: [] })
    expect(late.hoursLeft).toBe(3)
    expect(late.tiers.map((t) => t.possible)).toEqual([true, false, false])
    expect(planQuest({ ...base, targetHourlyYen: null }).worthIt).toBeNull()
  })

  it('費用（レンタル代など）を引いた時給で目標と比べる', () => {
    // 1時間300円の費用：第2段階は (1,100×2.5 + 1,500) ÷ 2.5 = 1,700円/時、第3段階は (1,100×10 + 4,000) ÷ 10 = 1,500円/時
    const p = planQuest({ ...base, costPerHourYen: 300, targetHourlyYen: 1800 })
    expect(p.tiers.map((t) => t.extraHourlyYen)).toEqual([null, 1700, 1500])
    expect(p.worthIt).toBeNull()
  })
})
