// 働ける時間
import { describe, expect, it } from 'vitest'
import { AVAILABILITY_PRESETS, availabilityProblems, availabilityRanges, weeklyAvailableHours } from './index'

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
