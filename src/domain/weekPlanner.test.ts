// 週の作戦エンジン：稼げる日に長く1回借りる・雨の日・荒天・昼夜の2回・クエストの段階ごとの選択肢
import { describe, expect, it } from 'vitest'
import { planWeekShifts, type PlannerInput } from './index'

const jst = (s: string) => new Date(`${s}+09:00`).toISOString()
const hourOf = (ms: number) => new Date(ms + 9 * 3_600_000).getUTCHours()
const dayOf = (ms: number) => new Date(ms + 9 * 3_600_000 - 4 * 3_600_000).getUTCDate()
/** 15分200円・2,500円で12時間まで上限 */
const hello = (seconds: number) => Math.min(Math.ceil(seconds / 900) * 200, 2500)

/** 土（10日）・日（11日）の 10〜22時だけ働ける。1時間 2件・1,400円 */
const base: PlannerInput = {
  now: jst('2026-10-07T12:00:00'),
  from: jst('2026-10-05T04:00:00'),
  to: jst('2026-10-12T04:00:00'),
  hour: (t) => {
    const d = dayOf(t)
    const h = hourOf(t)
    return (d === 10 || d === 11) && h >= 10 && h < 22 ? { revenueYen: 1400, orders: 2 } : null
  },
  rentalFee: hello,
  maxDayHours: 10,
  budgetHours: 10,
  fixed: [],
  quest: null,
  peaks: [],
  targetHourlyYen: null,
}

describe('週の作戦エンジン', () => {
  it('レンタルの上限があると、2日に5時間ずつより、1日に10時間まとめて借りる', () => {
    const best = planWeekShifts(base).options[0]!
    expect(best).toMatchObject({ key: 'best', workDays: 1, hours: 10, orders: 20, revenueYen: 14000, rentalYen: 2500, profitYen: 11500 })
  })

  it('雨の日（件数×1.5・1件×1.1）があればその日を選び、荒天の時間は使わない', () => {
    const rainy: PlannerInput = {
      ...base,
      hour: (t) => {
        const v = base.hour(t)
        if (!v) return null
        if (dayOf(t) === 11 && hourOf(t) >= 18) return null // 日曜の夜は荒天
        return dayOf(t) === 11 ? { revenueYen: v.revenueYen * 1.65, orders: v.orders * 1.5 } : v
      },
    }
    const best = planWeekShifts(rainy).options[0]!
    // 雨の日曜に荒天の前まで（10〜18時の8時間）。残り2時間は土曜（2時間でもレンタル代を引いて得なので）
    const sun = best.days.find((d) => d.dayStart === jst('2026-10-11T04:00:00'))!
    expect(sun.shifts.map((s) => [hourOf(Date.parse(s.startsAt)), hourOf(Date.parse(s.endsAt))])).toEqual([[10, 18]])
    expect(best.hours).toBe(10)
  })

  it('昼と夜が稼げて午後が空く日は2回に分け、借りたままと返すの安い方（借りたまま 2,500円）にする', () => {
    const s = planWeekShifts({
      ...base,
      budgetHours: 7,
      maxDayHours: 7,
      hour: (t) => {
        const v = base.hour(t)
        if (!v || dayOf(t) !== 10) return null
        const h = hourOf(t)
        return { revenueYen: (h >= 11 && h < 14) || (h >= 17 && h < 21) ? 2000 : 300, orders: 2 }
      },
    })
    const day = s.options[0]!.days.find((d) => d.shifts.length > 0)!
    expect(day.shifts.map((x) => [hourOf(Date.parse(x.startsAt)), hourOf(Date.parse(x.endsAt))])).toEqual([
      [11, 14],
      [17, 21],
    ])
    expect(day).toMatchObject({ rentalYen: 2500, returnBetween: false })
  })

  it('日跨ぎの段階ごとに選択肢を出す：目標時給 1,500円なら、クエストなしは休み、最低は10時間、本命（おすすめ）は15時間', () => {
    const s = planWeekShifts({
      ...base,
      rentalFee: null,
      budgetHours: null,
      targetHourlyYen: 1500,
      quest: {
        startsAt: jst('2026-10-09T04:00:00'),
        endsAt: jst('2026-10-12T04:00:00'),
        rewardMode: 'incremental',
        tiers: [
          { count: 20, rewardYen: 3000 },
          { count: 30, rewardYen: 2000 },
        ],
        count: 0,
      },
    })
    expect(s.options.map((o) => [o.key, o.label, o.hours, o.reachedTier])).toEqual([
      ['best', 'おすすめ・本命 30件', 15, 2],
      ['tier-1', '最低 20件', 10, 1],
      ['none', 'クエストを気にしない', 0, 0],
    ])
    expect(s.options[0]).toMatchObject({ orders: 30, revenueYen: 21000, bonusYen: 5000, profitYen: 26000 })
  })

  it('リーダーボードの攻める目標（本命より多い件数）の選択肢を出す。賞金は届くか分からないので利益に入れない', () => {
    const s = planWeekShifts({
      ...base,
      rentalFee: null,
      budgetHours: null,
      targetHourlyYen: 1500,
      quest: { startsAt: jst('2026-10-09T04:00:00'), endsAt: jst('2026-10-12T04:00:00'), rewardMode: 'incremental', tiers: [{ count: 20, rewardYen: 3000 }, { count: 30, rewardYen: 2000 }], count: 0 },
      attack: { rank: 4, count: 36, prizeYen: 1000 },
    })
    expect(s.options.map((o) => [o.key, o.label, o.hours, o.orders, o.prizeYen])).toEqual([
      ['best', 'おすすめ・本命 30件', 15, 30, 0],
      ['tier-1', '最低 20件', 10, 20, 0],
      ['attack', '攻める 4位 36件', 18, 36, 1000],
      ['none', 'クエストを気にしない', 0, 0, 0],
    ])
    expect(s.options[2]).toMatchObject({ bonusYen: 5000, profitYen: 18 * 1400 + 5000 })
    // 本命で届くなら、攻める選択肢は出さない
    const within = planWeekShifts({ ...base, rentalFee: null, budgetHours: null, quest: { startsAt: jst('2026-10-09T04:00:00'), endsAt: jst('2026-10-12T04:00:00'), rewardMode: 'incremental', tiers: [{ count: 30, rewardYen: 2000 }], count: 0 }, attack: { rank: 4, count: 25, prizeYen: 0 } })
    expect(within.options.some((o) => o.key === 'attack')).toBe(false)
  })

  it('すでに選んだ候補枠のある日はその枠で固定し、週の残り時間の中で組む', () => {
    const slot = { startsAt: jst('2026-10-11T12:00:00'), endsAt: jst('2026-10-11T16:00:00') }
    const best = planWeekShifts({ ...base, fixed: [slot] }).options[0]!
    const sun = best.days.find((d) => d.dayStart === jst('2026-10-11T04:00:00'))!
    expect(sun).toMatchObject({ fixed: true, hours: 4, orders: 8 })
    // 残り6時間は土曜にまとめて
    const sat = best.days.find((d) => d.dayStart === jst('2026-10-10T04:00:00'))!
    expect(sat.hours).toBe(6)
    expect(best.hours).toBe(10)
  })

  it('ピーク（同じサービスの短いクエスト）を覆うと、届く段階の報酬を足す', () => {
    const peakTiers = [1, 2, 3, 4, 5].map((c, i) => ({ count: c, rewardYen: [100, 150, 150, 200, 300][i]! }))
    const s = planWeekShifts({
      ...base,
      budgetHours: 4,
      peaks: [{ startsAt: jst('2026-10-11T11:30:00'), endsAt: jst('2026-10-11T14:00:00'), rewardMode: 'incremental', tiers: peakTiers, count: 0 }],
    })
    const best = s.options[0]!
    const day = best.days.find((d) => d.shifts.length > 0)!
    expect(day.dayStart).toBe(jst('2026-10-11T04:00:00'))
    // 11〜14時を含む4時間：ピークの2.5時間で5件 → 900円
    expect(day.peakBonusYen).toBe(900)
    expect(best.bonusYen).toBe(900)
  })

  it('日跨ぎの段階には、日跨ぎの期間（金4:00〜）の中の件数だけを数える', () => {
    const s = planWeekShifts({
      ...base,
      rentalFee: null,
      budgetHours: null,
      // 木曜（8日）だけ働ける：日跨ぎの期間の外
      hour: (t) => (dayOf(t) === 8 && hourOf(t) >= 10 && hourOf(t) < 20 ? { revenueYen: 1400, orders: 2 } : null),
      quest: { startsAt: jst('2026-10-09T04:00:00'), endsAt: jst('2026-10-12T04:00:00'), rewardMode: 'incremental', tiers: [{ count: 10, rewardYen: 3000 }], count: 0 },
    })
    expect(s.options[0]).toMatchObject({ orders: 20, reachedTier: 0, bonusYen: 0 })
  })

  it('レンタル代が出せない借り方（上限の12時間を超えて借りたまま）は選ばず、間で返す', () => {
    // 12時間までの料金（それを超えると出せない）
    const upTo12h = (sec: number) => (sec > 12 * 3600 ? null : Math.min(Math.ceil(sec / 900) * 200, 2500))
    const s = planWeekShifts({
      ...base,
      rentalFee: upTo12h,
      budgetHours: 8,
      maxDayHours: 8,
      hour: (t) => {
        if (dayOf(t) !== 10) return null
        const h = hourOf(t)
        // 朝 6〜10時と夜 19〜23時だけが稼げる（借りたままだと 6〜23時の17時間）
        return (h >= 6 && h < 10) || (h >= 19 && h < 23) ? { revenueYen: 2000, orders: 2 } : null
      },
    })
    const day = s.options[0]!.days.find((d) => d.shifts.length > 0)!
    expect(day.shifts).toHaveLength(2)
    expect(day).toMatchObject({ returnBetween: true, rentalYen: 5000 })
  })
})

