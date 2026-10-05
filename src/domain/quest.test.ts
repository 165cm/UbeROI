// クエストの進み具合と休憩前の返却
import { describe, expect, it } from 'vitest'
import { HELLO_TOKYO_CITY, breakAdvice, questProgress, selectiveQuestPeriod, type QuestInput } from './index'

describe('選択制クエストの期間（日本時間 月曜4:00／金曜4:00 区切り）', () => {
  it('平日と週末を正しく切り分ける', () => {
    // 2026-10-05 は月曜。月曜 10:00 JST
    expect(selectiveQuestPeriod('2026-10-05T01:00:00Z')).toMatchObject({ startsAt: '2026-10-04T19:00:00.000Z', endsAt: '2026-10-08T19:00:00.000Z' })
    // 月曜 3:59 JST はまだ前の週末
    expect(selectiveQuestPeriod('2026-10-04T18:59:00Z')).toMatchObject({ startsAt: '2026-10-01T19:00:00.000Z', endsAt: '2026-10-04T19:00:00.000Z' })
    // 金曜 4:00 JST から週末
    expect(selectiveQuestPeriod('2026-10-08T19:00:00Z').label).toContain('週末')
    expect(selectiveQuestPeriod('2026-10-08T18:59:00Z').label).toContain('平日')
  })
})

const quest = (over: Partial<QuestInput> = {}): QuestInput => ({
  startsAt: '2026-10-04T19:00:00Z',
  endsAt: '2026-10-08T19:00:00Z',
  rewardMode: 'incremental',
  tiers: [
    { count: 10, rewardYen: 700 },
    { count: 20, rewardYen: 1200 },
  ],
  manualOffset: 0,
  ...over,
})

const done = (returnedAt: string, n: number | null, eligible = true) => ({ status: 'completed' as const, returnedAt, completedCount: n, eligible })

describe('進み具合', () => {
  it('期間内・対象サービスの確定記録の件数を足し、次の段階まで何件かを出す', () => {
    const p = questProgress(
      quest(),
      [
        done('2026-10-05T12:00:00Z', 8),
        done('2026-10-06T12:00:00Z', 5),
        done('2026-10-06T13:00:00Z', 9, false), // 対象外のサービス
        done('2026-10-09T12:00:00Z', 7), // 期間外
        { status: 'draft' as const, returnedAt: '2026-10-07T12:00:00Z', completedCount: 3, eligible: true }, // 下書き
        done('2026-10-07T12:00:00Z', null), // 件数未入力
      ],
      '2026-10-07T13:00:00Z',
    )
    expect(p.count).toBe(13)
    expect(p.reachedTier).toBe(1)
    expect(p.earnedYen).toBe(700)
    expect(p.next).toEqual({ tier: 2, remaining: 7, gainYen: 1200 })
    expect(p.unknownCountSessions).toBe(1)
    expect(p.ended).toBe(false)
  })

  it('累積の額なら、次の段階の上乗せは差分（仕様 05）', () => {
    const p = questProgress(
      quest({ rewardMode: 'cumulative', tiers: [{ count: 10, rewardYen: 700 }, { count: 20, rewardYen: 1900 }], manualOffset: 12 }),
      [],
      '2026-10-07T13:00:00Z',
    )
    expect(p.earnedYen).toBe(700)
    expect(p.next).toEqual({ tier: 2, remaining: 8, gainYen: 1200 })
  })

  it('全段階を達成したら次はなし、期間が過ぎたら終了', () => {
    const p = questProgress(quest({ manualOffset: 25 }), [], '2026-10-09T00:00:00Z')
    expect(p.next).toBeNull()
    expect(p.earnedYen).toBe(1900)
    expect(p.ended).toBe(true)
  })
})

describe('休憩前の返却', () => {
  it('貸出1時間・休憩2時間・休憩後3時間：借りたままは上限まで上がるので、返すほうが260円安い', () => {
    // 借りたまま：F(6h)=2500 − F(1h)=480 → 2020円。返して借り直す：F(3h)=1760円
    const a = breakAdvice(HELLO_TOKYO_CITY, '2026-10-05T05:00:00Z', '2026-10-05T06:00:00Z', 120, 180)
    expect(a).toEqual({ keepYen: 2020, returnAndReRentYen: 1760, savingYen: 260 })
  })

  it('上限に近い時は借りたままのほうが安いこともある（節約額がマイナス）', () => {
    // 貸出200分：F=2080。借りたまま1時間休憩＋1時間：F(320分)=2500 − 2080 = 420円。借り直す：F(60分)=480円
    const a = breakAdvice(HELLO_TOKYO_CITY, '2026-10-05T00:00:00Z', '2026-10-05T03:20:00Z', 60, 60)
    expect(a.savingYen).toBe(-60)
  })
})
