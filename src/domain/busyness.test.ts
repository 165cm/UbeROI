// エリアの混み具合（曜日×1時間×4段階）と、売上の見込みへの反映
import { describe, expect, it } from 'vitest'
import { BUSY_LEVEL_FACTORS, averageLevel, busyAhead, busyLevelAt, busynessSlot, emptyBusyness, estimateRevenue, isBusynessTable } from './index'

const ms = (iso: string) => Date.parse(iso)

describe('混み具合の表', () => {
  it('日本時間・4時区切りで曜日を決める（月曜2時は日曜の表、月曜4時から月曜の表）', () => {
    // 2026-10-05 は月曜
    expect(busynessSlot(ms('2026-10-04T17:00:00Z'))).toEqual({ weekday: 0, hour: 2 }) // 月曜 2:00 JST
    expect(busynessSlot(ms('2026-10-04T19:00:00Z'))).toEqual({ weekday: 1, hour: 4 }) // 月曜 4:00 JST
    expect(busynessSlot(ms('2026-10-05T13:30:00Z'))).toEqual({ weekday: 1, hour: 22 }) // 月曜 22:30 JST
  })

  it('入力した段階を返し、未入力は null', () => {
    const t = emptyBusyness()
    t[1]![22] = 4
    expect(busyLevelAt(t, ms('2026-10-05T13:30:00Z'))).toBe(4)
    expect(busyLevelAt(t, ms('2026-10-05T12:30:00Z'))).toBeNull()
  })

  it('形が正しいかを確かめる（7×24、0〜4の整数）', () => {
    expect(isBusynessTable(emptyBusyness())).toBe(true)
    const bad = emptyBusyness()
    bad[0]![0] = 5
    expect(isBusynessTable(bad)).toBe(false)
    expect(isBusynessTable([[1]])).toBe(false)
  })
})

describe('混み具合を売上の見込みに使う', () => {
  const table = emptyBusyness()
  // 月曜 17〜20時 JST：17時=段階2、18時・19時=段階4
  table[1]![17] = 2
  table[1]![18] = 4
  table[1]![19] = 4

  it('実績が10回未満なら、時間帯の倍率の代わりに段階の倍率を使う（月の倍率は掛けない）', () => {
    const e = estimateRevenue('2026-10-05T08:00:00Z', '2026-10-05T11:00:00Z', [], table)
    expect(e.source).toBe('busyness')
    expect(e.revenueYen).toBe(Math.round(1400 * (BUSY_LEVEL_FACTORS[2]! + BUSY_LEVEL_FACTORS[4]! * 2)))
    expect(e.note).toContain('混み具合')
  })

  it('未入力の時間は時間帯の倍率で補う。全部未入力なら今まで通り参考資料の推計', () => {
    // 月曜 20〜21時（未入力・ディナー 1.2）を足した4時間
    const e = estimateRevenue('2026-10-05T08:00:00Z', '2026-10-05T12:00:00Z', [], table)
    expect(e.revenueYen).toBe(Math.round(1400 * (0.85 + 1.35 * 2 + 1.2)))
    expect(estimateRevenue('2026-10-05T08:00:00Z', '2026-10-05T11:00:00Z', [], emptyBusyness()).source).toBe('reference')
  })

  it('実績が10回以上なら自分の平均を、この枠と実績の混み具合の比で補正する', () => {
    // 実績：月曜17時台（段階2）に1時間・2,000円 × 10回 → 平均 2,000円/時
    const past = Array.from({ length: 10 }, (_, i) => ({ departedAt: `2026-09-${String(7 * (i % 4) + 7).padStart(2, '0')}T08:00:00Z`, hours: 1, revenueYen: 2000 }))
    // 同じ曜日・同じ時間なら補正なし
    expect(estimateRevenue('2026-10-05T08:00:00Z', '2026-10-05T09:00:00Z', past, table).revenueYen).toBe(2000)
    // 18時台（段階4）なら 1.35 ÷ 0.85 倍
    const busier = estimateRevenue('2026-10-05T09:00:00Z', '2026-10-05T10:00:00Z', past, table)
    expect(busier.revenueYen).toBe(Math.round(2000 * (1.35 / 0.85)))
    expect(busier.note).toContain('混み具合で×')
    // 混み具合がなければ今まで通り
    expect(estimateRevenue('2026-10-05T09:00:00Z', '2026-10-05T10:00:00Z', past).revenueYen).toBe(2000)
  })
})

describe('この先の混み具合（ホーム）', () => {
  it('今の時間（正時で切る）から4時間分の段階と、入力済みの平均', () => {
    const t = emptyBusyness()
    t[1]![18] = 4
    t[1]![19] = 3
    t[1]![21] = 1
    const ahead = busyAhead(t, Date.parse('2026-10-05T18:40:00+09:00'))
    expect(ahead.map((c) => c.level)).toEqual([4, 3, null, 1])
    expect(new Date(ahead[0]!.startMs).toISOString()).toBe('2026-10-05T09:00:00.000Z')
    expect(averageLevel(ahead.map((c) => c.level))).toBe(2.7)
    expect(averageLevel([null, null])).toBeNull()
  })
})
