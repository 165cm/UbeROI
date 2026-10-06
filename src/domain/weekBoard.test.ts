// 計画：空いている、稼げそうな時間のおすすめ
import { describe, expect, it } from 'vitest'
import { deadlineMs, emptyBusyness, suggestWindows, type SuggestInput } from './index'

const jst = (s: string) => new Date(`${s}+09:00`).toISOString()
const hourOf = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).getUTCHours()

/** 月〜日の 11〜13時 は段階3、18〜20時 は段階4、ほかは段階1。1時間の売上 = 段階 × 500円 */
function table() {
  const t = emptyBusyness()
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) t[d]![h] = h >= 18 && h <= 20 ? 4 : h >= 11 && h <= 13 ? 3 : 1
  return t
}
const busyness = table()
const base: SuggestInput = {
  now: jst('2026-10-07T12:30:00'),
  from: jst('2026-10-05T00:00:00'),
  to: jst('2026-10-12T00:00:00'),
  busyness,
  busy: [],
  estimate: (s, e) => {
    let y = 0
    for (let h = Date.parse(s); h < Date.parse(e); h += 3_600_000) y += [0, 1, 0, 3, 4][busyness[0]![hourOf(new Date(h).toISOString())]!]! * 500
    return y
  },
}

describe('空いている、稼げそうな時間', () => {
  it('これからの時間から、1日1つ・最大3つ、見込みの大きい時間を早い順に出す', () => {
    const r = suggestWindows(base)
    // 今日（水）の18〜21時、木の18〜21時、金の18〜21時（どれも 6,000円。同じなら早い日）
    expect(r.map((w) => [w.startsAt, w.revenueYen, w.levels])).toEqual([
      [jst('2026-10-07T18:00:00'), 6000, [4, 4, 4]],
      [jst('2026-10-08T18:00:00'), 6000, [4, 4, 4]],
      [jst('2026-10-09T18:00:00'), 6000, [4, 4, 4]],
    ])
  })

  it('予定・実績と重なる時間と、帰宅締切を過ぎる時間は出さない', () => {
    const r = suggestWindows({
      ...base,
      busy: [{ startsAt: jst('2026-10-07T17:00:00'), endsAt: jst('2026-10-07T22:00:00') }],
      deadline: (s) => deadlineMs(s, '20:30'),
    })
    // 水の夜は予定あり。締切20:30なので夜は 17〜20時（500+2,000+2,000 = 4,500円）までで、昼の 11〜14時（4,500円）と同じ。同じなら早い方
    expect(r.map((w) => [w.startsAt, w.revenueYen])).toEqual([
      [jst('2026-10-08T11:00:00'), 4500],
      [jst('2026-10-09T11:00:00'), 4500],
      [jst('2026-10-10T11:00:00'), 4500],
    ])
  })

  it('混み具合が入っていない時間を含む枠は出さない', () => {
    expect(suggestWindows({ ...base, busyness: emptyBusyness() })).toEqual([])
  })
})
