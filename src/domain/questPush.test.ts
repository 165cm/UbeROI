// 稼働中の「あと何件続ける？」：段階・順位・攻める目標まであと何件・何分、終了予定までに届くか
import { describe, expect, it } from 'vitest'
import { pushOrdersPerHour, questPushGoals, type QuestPushInput } from './index'

const jst = (s: string) => new Date(`${s}+09:00`).toISOString()

/** 日曜 20時、日跨ぎ 47件（40件・50件・60件の段階）。1時間3件・2,400円。終了予定 21時、配達は 22時まで */
const base: QuestPushInput = {
  now: jst('2026-10-11T20:00:00'),
  endAt: jst('2026-10-11T21:00:00'),
  lastAt: jst('2026-10-11T22:00:00'),
  questEndsAt: jst('2026-10-12T04:00:00'),
  count: 47,
  rewardMode: 'incremental',
  tiers: [
    { count: 40, rewardYen: 3770 },
    { count: 50, rewardYen: 1170 },
    { count: 60, rewardYen: 1000 },
  ],
  board: null,
  baseOrdersPerHour: 3,
  sessionMinutes: 30,
  sessionCount: 1,
  revenuePerHourYen: 2400,
}

describe('あと何件続ける？', () => {
  it('次の段階は終了予定までに届き、その次の段階は延ばしても届かない', () => {
    const r = questPushGoals(base)
    expect(r.goals.map((g) => [g.labels, g.more, g.minutes, g.gainYen, g.reach, g.extendMinutes])).toEqual([
      [['第2段階 50件'], 3, 60, 1170, 'fits', 0],
      [['第3段階 60件'], 13, 260, 2170, 'no', 0],
    ])
    // 延ばした分の時給の目安：（2,400円×1時間＋1,170円）÷1時間
    expect(r.goals[0]!.hourlyYen).toBe(3570)
  })

  it('終了予定を過ぎても、配達を続けられる時刻までに届くなら「延ばせば届く」', () => {
    const r = questPushGoals({ ...base, endAt: jst('2026-10-11T20:30:00') })
    expect(r.goals[0]).toMatchObject({ reach: 'extend', extendMinutes: 30 })
    // クエストの終わりを過ぎるなら届かない
    expect(questPushGoals({ ...base, endAt: jst('2026-10-11T20:30:00'), questEndsAt: jst('2026-10-11T20:45:00') }).goals[0]!.reach).toBe('no')
  })

  it('この稼働が45分以上で1件以上なら、今日のペースと半々にする', () => {
    expect(pushOrdersPerHour(3, 30, 1)).toEqual({ rate: 3, usesPace: false })
    // 今日は60分で5件 → (3 + 5) ÷ 2 = 4件
    expect(pushOrdersPerHour(3, 60, 5)).toEqual({ rate: 4, usesPace: true })
    expect(pushOrdersPerHour(2, 90, 0)).toEqual({ rate: 2, usesPace: false })
  })

  it('1時間の件数が0（件数入りの記録がすべて0件など）なら、時間は出せず届かない', () => {
    const g = questPushGoals({ ...base, baseOrdersPerHour: 0 }).goals[0]!
    expect(g).toMatchObject({ more: 3, minutes: null, hourlyYen: null, reach: 'no' })
  })

  it('リーダーボード：まだ抜いていない一番近い上の順位と、攻める目標。同じ件数の目標は1つの行にまとめる', () => {
    const r = questPushGoals({
      ...base,
      board: {
        at: jst('2026-10-11T19:00:00'),
        myRank: 5,
        myCount: 47,
        above: [
          { rank: 4, count: 49, gap: 2 },
          { rank: 3, count: 55, gap: 8 },
        ],
        target: { rank: 3, need: 60, more: 13, prizeYen: 1000, projection: { rank: 3, count: 55, atEnd: 59, method: 'pace' } },
      },
    })
    expect(r.goals.map((g) => [g.labels, g.target])).toEqual([
      [['第2段階 50件', '4位を抜く'], 50],
      [['第3段階 60件', '攻める 3位'], 60],
    ])
  })

  it('リーダーボードの件数がクエストより多い時（記録していない配達）は、その差をそろえる。届いた段階は出さない', () => {
    const r = questPushGoals({
      ...base,
      count: 50,
      board: { at: jst('2026-10-11T19:00:00'), myRank: 5, myCount: 52, above: [{ rank: 4, count: 53, gap: 1 }], target: null },
    })
    // 4位（53件）を抜くには、リーダーボードで54件＝クエストで 50 + 2 = 52件
    expect(r.goals.map((g) => [g.labels, g.target, g.more])).toEqual([
      [['4位を抜く'], 52, 2],
      [['第3段階 60件'], 60, 10],
    ])
  })
})
