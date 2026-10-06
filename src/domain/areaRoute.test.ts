// 時間帯ごとのエリア計画
import { describe, expect, it } from 'vitest'
import { emptyBusyness, planAreaRoute, routeMoveMinutes, type RouteArea } from './index'

const jst = (s: string) => new Date(`${s}+09:00`).toISOString()
const hourOf = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).getUTCHours()

/** 1時間あたりの売上を時刻ごとに決めた、テスト用のエリア */
function area(id: string, moveMinutes: number, perHour: (hour: number) => number): RouteArea {
  return {
    id,
    name: id,
    moveMinutes,
    levels: emptyBusyness(),
    estimate: (s, e) => Math.round(perHour(hourOf(s)) * ((Date.parse(e) - Date.parse(s)) / 3_600_000)),
  }
}

describe('時間帯ごとのエリア計画', () => {
  const main = area('中野', 0, () => 1000)

  it('混む時間に合わせて移動し、移動の分はその時間の売上から引く', () => {
    const b = area('荻窪', 10, (h) => (h >= 19 ? 2500 : 500))
    const r = planAreaRoute(jst('2026-10-05T17:00:00'), jst('2026-10-05T21:00:00'), [main, b])!
    expect(r.stints.map((s) => [s.areaName, hourOf(s.startsAt), s.moveMinutes, s.revenueYen])).toEqual([
      ['中野', 17, 0, 2000],
      // 19:10 に着く：50分 × 2,500円 + 2,500円
      ['荻窪', 19, 10, 2083 + 2500],
    ])
    expect(r.stints[1]!.startsAt).toBe(jst('2026-10-05T19:10:00'))
    expect(r).toMatchObject({ revenueYen: 6583, stayYen: 4000, gainYen: 2583, moves: 1 })
  })

  it('移動しても200円（手間と外れのリスク）以上良くならないなら、主なエリアにいる', () => {
    const b = area('荻窪', 10, (h) => (h >= 19 ? 1200 : 500))
    const r = planAreaRoute(jst('2026-10-05T17:00:00'), jst('2026-10-05T21:00:00'), [main, b])!
    expect(r.stints.map((s) => s.areaName)).toEqual(['中野'])
    expect(r).toMatchObject({ gainYen: 0, moves: 0 })
  })

  it('主なエリア以外の2つの間は、主なエリアを通る分の合計を目安にする。区間より長い移動はしない', () => {
    const b = area('荻窪', 10, () => 0)
    const c = area('吉祥寺', 15, () => 0)
    expect(routeMoveMinutes(b, c)).toBe(25)
    expect(routeMoveMinutes(main, c)).toBe(15)
    expect(routeMoveMinutes(c, main)).toBe(15)
    // 20分しかない区間には、25分かかる移動はできない
    const far = area('遠く', 30, () => 9000)
    const r = planAreaRoute(jst('2026-10-05T17:40:00'), jst('2026-10-05T18:00:00'), [main, far])!
    expect(r.stints.map((s) => s.areaName)).toEqual(['中野'])
  })

  it('途中の時刻から始まる時は、最初の正時までを1つの区間にする', () => {
    const b = area('荻窪', 10, (h) => (h >= 18 ? 3000 : 0))
    const r = planAreaRoute(jst('2026-10-05T17:30:00'), jst('2026-10-05T19:00:00'), [area('中野', 0, () => 1200), b])!
    expect(r.stints.map((s) => [s.areaName, s.startsAt])).toEqual([
      ['中野', jst('2026-10-05T17:30:00')],
      ['荻窪', jst('2026-10-05T18:10:00')],
    ])
    // 中野 30分 × 1,200円 ＋ 荻窪 50分 × 3,000円
    expect(r.revenueYen).toBe(600 + 2500)
  })

  it('エリアがない・時間が0以下なら出さない', () => {
    expect(planAreaRoute(jst('2026-10-05T17:00:00'), jst('2026-10-05T18:00:00'), [])).toBeNull()
    expect(planAreaRoute(jst('2026-10-05T18:00:00'), jst('2026-10-05T18:00:00'), [main])).toBeNull()
  })
})
