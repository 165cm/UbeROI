// 働ける時間と、作戦の時間の組み立て
import { describe, expect, it } from 'vitest'
import { AVAILABILITY_PRESETS, availabilityProblems, availabilityRanges, questStrategy, scheduleStrategy, weeklyAvailableHours, type StrategyInput, type StrategyQuest } from './index'

const jst = (s: string) => new Date(`${s}+09:00`).toISOString()
const ms = (s: string) => Date.parse(jst(s))
const sideNight = AVAILABILITY_PRESETS.find((p) => p.key === 'side-night')!.days

describe('働ける時間', () => {
  it('プリセット「副業：平日は夜だけ」は、平日 19〜23時・土日 10〜22時（1週間 44時間）', () => {
    expect(weeklyAvailableHours(sideNight)).toBe(44)
    const r = availabilityRanges(sideNight, ms('2026-10-09T04:00:00'), ms('2026-10-12T04:00:00'))
    expect(r.map(([a, b]) => [new Date(a).toISOString(), new Date(b).toISOString()])).toEqual([
      [jst('2026-10-09T19:00:00'), jst('2026-10-09T23:00:00')],
      [jst('2026-10-10T10:00:00'), jst('2026-10-10T22:00:00')],
      [jst('2026-10-11T10:00:00'), jst('2026-10-11T22:00:00')],
    ])
  })

  it('終了が開始より前なら翌日まで（月曜 19:00〜02:00 → 火曜 2時まで）。前の日の夜から続く分も入る', () => {
    const av = Array.from({ length: 7 }, (_, d) => (d === 1 ? [{ start: '19:00', end: '02:00' }] : []))
    expect(weeklyAvailableHours(av)).toBe(7)
    const r = availabilityRanges(av, ms('2026-10-06T00:00:00'), ms('2026-10-06T12:00:00'))
    expect(r).toEqual([[ms('2026-10-06T00:00:00'), ms('2026-10-06T02:00:00')]])
  })

  it('形の誤りを知らせる', () => {
    expect(availabilityProblems(sideNight)).toEqual([])
    expect(availabilityProblems([[{ start: '9:00', end: '12:00' }], [], [], [], [], [], []])).toEqual(['働ける時間は 19:00 のように入れてください'])
    expect(availabilityProblems([[], [{ start: '10:00', end: '10:00' }], [], [], [], [], []])).toEqual(['月曜：開始と終了が同じです'])
    expect(availabilityProblems([])).toEqual(['働ける時間は7曜日分で入れてください'])
  })
})

const peakTiers = [1, 2, 3, 4, 5].map((c, i) => ({ count: c, rewardYen: [100, 150, 150, 200, 300][i]! }))
const peak = (day: string, from: string, to: string, label: string): StrategyQuest => ({
  label,
  startsAt: jst(`${day}T${from}:00`),
  endsAt: jst(`${day}T${to}:00`),
  rewardMode: 'incremental',
  tiers: peakTiers,
  count: 0,
})
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
  peaks: ['2026-10-09', '2026-10-10', '2026-10-11'].flatMap((d) => [peak(d, '11:30', '14:00', '昼ピーク'), peak(d, '16:30', '20:00', '夜ピーク')]),
  ordersPerHour: 2,
  revenuePerOrderYen: 700,
}

describe('働ける時間の中での作戦', () => {
  const allowed = availabilityRanges(sideNight, ms('2026-10-07T00:00:00'), ms('2026-10-12T04:00:00'))
  const s = questStrategy({ ...base, allowed })

  it('働けない時間のピークは数えず、一部だけ重なるピークは重なる時間で数える', () => {
    // 金曜は 19時から：昼ピークは数えない、夜ピークは 19〜20時の1時間（1時間2件だと2件）
    expect(s.skippedPeaks).toEqual([{ label: '昼ピーク', startsAt: jst('2026-10-09T11:30:00'), endsAt: jst('2026-10-09T14:00:00') }])
    expect(s.warnings).toEqual([{ label: '夜ピーク', startsAt: jst('2026-10-09T19:00:00'), endsAt: jst('2026-10-09T20:00:00'), need: 5, canDo: 2 }])
    const g50 = s.goals.find((g) => g.target === 50)!
    // ピーク：金5・土10・日10＝25件、ほか25件を 9・8・8
    expect(g50.days.map((d) => [d.peakCount, d.extraCount, d.hours])).toEqual([
      [5, 9, 7],
      [10, 8, 10],
      [10, 8, 10],
    ])
  })

  it('日ごとの時間を、ピーク→働ける時間の中の空きの順に置く。働ける時間に入らない分は足りない時間として出す', () => {
    const g50 = s.goals.find((g) => g.target === 50)!
    const plan = scheduleStrategy({
      now: base.now,
      goal: g50,
      peaks: s.peaks,
      allowed,
      busy: [],
      planned: [],
      busyness: null,
      estimate: (a, b) => ((Date.parse(b) - Date.parse(a)) / 3_600_000) * 1400,
      ordersPerHour: 2,
    })
    // 金曜：働けるのは 19〜23時の4時間だけ（夜ピーク 19〜20時＋20〜23時）。7時間のうち3時間足りない
    expect(plan.days[0]!.windows.map((w) => [w.startsAt, w.endsAt])).toEqual([
      [jst('2026-10-09T19:00:00'), jst('2026-10-09T20:00:00')],
      [jst('2026-10-09T20:00:00'), jst('2026-10-09T23:00:00')],
    ])
    expect(plan.days[0]!.shortHours).toBe(3)
    // 土曜：昼・夜のピーク（6時間）＋働ける時間の空きで4時間、足りなくはない
    expect(plan.days[1]!.shortHours).toBe(0)
    expect(plan.days[1]!.windows.every((w) => Date.parse(w.startsAt) >= ms('2026-10-10T10:00:00') && Date.parse(w.endsAt) <= ms('2026-10-10T22:00:00'))).toBe(true)
    expect(plan.hours).toBe(4 + 10 + 10)
    expect(plan.shortHours).toBe(3)
  })

  it('すでに選んだ候補枠の時間は差し引き、重ねない', () => {
    const g50 = s.goals.find((g) => g.target === 50)!
    const slot = { startsAt: jst('2026-10-10T10:00:00'), endsAt: jst('2026-10-10T14:00:00') }
    const plan = scheduleStrategy({ now: base.now, goal: g50, peaks: s.peaks, allowed, busy: [slot], planned: [slot], busyness: null, estimate: () => 0, ordersPerHour: 2 })
    expect(plan.days[1]!.plannedHours).toBe(4)
    // 土曜は 10時間 − 4時間 ＝ 6時間：夜ピーク 3.5時間（昼ピークは候補枠と重なる）＋ほか2.5時間
    const hours = plan.days[1]!.windows.reduce((a, w) => a + (Date.parse(w.endsAt) - Date.parse(w.startsAt)) / 3_600_000, 0)
    expect(hours).toBeGreaterThanOrEqual(6)
    expect(plan.days[1]!.windows.some((w) => w.startsAt < slot.endsAt && w.endsAt > slot.startsAt)).toBe(false)
  })

  it('ある日の選んだ候補枠がその日の分より多ければ、余りをほかの日の「ほか」の時間から差し引く', () => {
    const g50 = s.goals.find((g) => g.target === 50)!
    // 金曜に 10〜23時は働けないが、候補枠は働ける時間と関係なく数える：金曜 13時間（その日は7時間）→ 6時間の余り
    const slot = { startsAt: jst('2026-10-09T10:00:00'), endsAt: jst('2026-10-09T23:00:00') }
    const plan = scheduleStrategy({ now: base.now, goal: g50, peaks: s.peaks, allowed, busy: [slot], planned: [slot], busyness: null, estimate: () => 0, ordersPerHour: 2 })
    const hoursOf = (k: number) => plan.days[k]!.windows.reduce((a, w) => a + (Date.parse(w.endsAt) - Date.parse(w.startsAt)) / 3_600_000, 0)
    // 日曜の「ほか」8件＝4時間を全部、土曜の「ほか」4時間のうち2時間を差し引く：土曜は 10−2＝8時間、日曜は 10−4＝6時間（ピークの6時間だけ）
    expect(hoursOf(0)).toBe(0)
    expect(hoursOf(1)).toBe(8)
    expect(hoursOf(2)).toBe(6)
  })
})

