// クエスト作戦表：日跨ぎ（金4:00〜月4:00）＋毎日の昼・夜のピーク
import { describe, expect, it } from 'vitest'
import { questStrategy, type StrategyInput, type StrategyQuest } from './index'

const jst = (s: string) => new Date(`${s}+09:00`).toISOString()
const peakTiers = [
  { count: 1, rewardYen: 100 },
  { count: 2, rewardYen: 150 },
  { count: 3, rewardYen: 150 },
  { count: 4, rewardYen: 200 },
  { count: 5, rewardYen: 300 },
]
const peak = (day: string, from: string, to: string, label: string, count = 0): StrategyQuest => ({
  label,
  startsAt: jst(`${day}T${from}:00`),
  endsAt: jst(`${day}T${to}:00`),
  rewardMode: 'incremental',
  tiers: peakTiers,
  count,
})
const days = ['2026-10-09', '2026-10-10', '2026-10-11']
const base: StrategyInput = {
  now: jst('2026-10-07T00:05:00'),
  main: {
    label: '日跨ぎ',
    startsAt: jst('2026-10-09T04:00:00'),
    endsAt: jst('2026-10-12T04:00:00'),
    rewardMode: 'incremental',
    tiers: [
      { count: 40, rewardYen: 3770 },
      { count: 50, rewardYen: 1170 },
    ],
    count: 0,
  },
  peaks: days.flatMap((d) => [peak(d, '11:30', '14:00', '昼ピーク'), peak(d, '16:30', '20:00', '夜ピーク')]),
  ordersPerHour: 2,
  revenuePerOrderYen: 700,
}

describe('クエスト作戦表', () => {
  it('50件：ピークで5件×2×3日＝30件、残り20件を金7・土7・日6に。報酬は 4,940円＋900円×6＝10,340円（1件あたり約207円）', () => {
    const s = questStrategy(base)
    const g50 = s.goals.find((g) => g.target === 50)!
    expect(g50.days.map((d) => [d.startsAt, d.peakCount, d.extraCount, d.total])).toEqual([
      [jst('2026-10-09T04:00:00'), 10, 7, 17],
      [jst('2026-10-10T04:00:00'), 10, 7, 17],
      [jst('2026-10-11T04:00:00'), 10, 6, 16],
    ])
    // ピークの時間（2.5h＋3.5h＝6h）＋ほかの7件÷2件/時＝3.5h
    expect(g50.days[0]!.hours).toBe(9.5)
    expect(g50).toMatchObject({ bonusYen: 10340, bonusPerOrderYen: 207, revenueYen: 50 * 700 + 10340, hours: 9.5 + 9.5 + 9 })
    // 40件：ほかは10件（4・3・3）。報酬 3,770円＋5,400円
    const g40 = s.goals.find((g) => g.target === 40)!
    expect(g40.days.map((d) => d.extraCount)).toEqual([4, 3, 3])
    expect(g40.bonusYen).toBe(9170)
    expect(s.warnings).toEqual([])
  })

  it('ピークの時間に1時間の件数では最後の段階に届かない時は知らせる。終わったピーク・届いた段階は数えない', () => {
    const s = questStrategy({
      ...base,
      // 土曜の16時：金曜は終わり、土曜の昼は済み（5件）、夜は 16:30〜18:30 の2時間しかない
      now: jst('2026-10-10T16:00:00'),
      main: { ...base.main, count: 22 },
      peaks: [
        peak('2026-10-09', '11:30', '14:00', '昼ピーク', 5),
        peak('2026-10-10', '11:30', '14:00', '昼ピーク', 5),
        peak('2026-10-10', '16:30', '18:30', '夜ピーク'),
        peak('2026-10-11', '11:30', '14:00', '昼ピーク'),
        peak('2026-10-11', '16:30', '20:00', '夜ピーク'),
      ],
    })
    expect(s.warnings).toEqual([{ label: '夜ピーク', startsAt: jst('2026-10-10T16:30:00'), endsAt: jst('2026-10-10T18:30:00'), need: 5, canDo: 4 }])
    const g50 = s.goals.find((g) => g.target === 50)!
    // 残り28件：ピークは 土の夜5＋日の昼夜10＝15件、ほかは13件を土7・日6
    expect(g50.days.map((d) => [d.peakCount, d.extraCount])).toEqual([
      [5, 7],
      [10, 6],
    ])
    // 報酬：日跨ぎ 4,940円＋ピーク 900円×3（土の夜・日の昼夜。土の昼と金は届いた・終わった）
    expect(g50.bonusYen).toBe(4940 + 2700)
  })

  it('もう届いた段階は出さない。1時間の件数が0なら時間は出さない', () => {
    const s = questStrategy({ ...base, main: { ...base.main, count: 41 }, ordersPerHour: 0 })
    expect(s.goals.map((g) => [g.target, g.remaining, g.hours])).toEqual([[50, 9, null]])
  })
})
