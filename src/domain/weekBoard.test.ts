// 計画：空いている、稼げそうな時間のおすすめ
import { describe, expect, it } from 'vitest'
import { deadlineMs, emptyBusyness, suggestHours, suggestWindows, type SuggestInput } from './index'

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

  it('4時をまたいで時間が重なる枠は、別の日でも同時に出さない', () => {
    const t = emptyBusyness()
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) t[d]![h] = h >= 2 && h <= 6 ? 4 : 1
    const level = (iso: string) => t[0]![hourOf(iso)]!
    const r = suggestWindows({
      ...base,
      now: jst('2026-10-07T00:00:00'),
      to: jst('2026-10-07T12:00:00'),
      busyness: t,
      estimate: (s, e) => {
        let y = 0
        for (let h = Date.parse(s); h < Date.parse(e); h += 3_600_000) y += level(new Date(h).toISOString()) * 500
        return y
      },
    })
    // 2〜5時（前の日）を選ぶと、4〜7時（次の日）は4〜5時が重なるので選ばず、5〜8時を選ぶ
    expect(r.map((w) => [hourOf(w.startsAt), hourOf(w.endsAt)])).toEqual([
      [2, 5],
      [5, 8],
    ])
  })
})

describe('クエストのための時間（必要な時間を、見込みの大きい枠で埋める）', () => {
  it('7時間なら 3時間・3時間・1時間 の枠を、見込みの大きい時間から選んで早い順に出す', () => {
    const r = suggestHours({ ...base, to: jst('2026-10-09T04:00:00'), hoursNeeded: 7 })
    // 水・木の 18〜21時（段階4×3）。残り1時間は段階4の時間が残っていないので、段階3のうち一番早い水曜 13時
    expect(r.windows.map((w) => [w.startsAt, w.endsAt])).toEqual([
      [jst('2026-10-07T13:00:00'), jst('2026-10-07T14:00:00')],
      [jst('2026-10-07T18:00:00'), jst('2026-10-07T21:00:00')],
      [jst('2026-10-08T18:00:00'), jst('2026-10-08T21:00:00')],
    ])
    expect(r).toMatchObject({ hours: 7, shortHours: 0 })
  })

  it('2.5時間なら3時間の枠1つ。期間の中に入る時間が足りなければ、足りない時間を返す', () => {
    expect(suggestHours({ ...base, hoursNeeded: 2.5 }).windows.map((w) => w.levels)).toEqual([[4, 4, 4]])
    // 水曜 12:30〜14:00 しか残っていない：入るのは 13〜14時の1時間だけ
    const r = suggestHours({ ...base, to: jst('2026-10-07T14:00:00'), hoursNeeded: 3 })
    expect(r.windows.map((w) => [w.startsAt, w.endsAt])).toEqual([[jst('2026-10-07T13:00:00'), jst('2026-10-07T14:00:00')]])
    expect(r).toMatchObject({ hours: 1, shortHours: 2 })
  })

  it('続いている枠は1つにまとめる', () => {
    const r = suggestHours({ ...base, now: jst('2026-10-07T17:00:00'), to: jst('2026-10-08T04:00:00'), busyness, hoursNeeded: 4 })
    // 水 17時〜翌4時の中で：まず 18〜21時（段階4×3）。残り1時間は段階1ばかりで、同じ見込みなら早い 17時 → 17〜21時に1つにまとまる
    expect(r.windows.map((w) => [w.startsAt, w.endsAt, w.levels])).toEqual([[jst('2026-10-07T17:00:00'), jst('2026-10-07T21:00:00'), [1, 4, 4, 4]]])
  })
})

