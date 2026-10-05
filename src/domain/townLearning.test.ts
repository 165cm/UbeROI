// 地名の評価の自動学習：受けた配達を終えてから次のオファーまでの待ち時間を、地名×時間帯ごとに集める
import { describe, expect, it } from 'vitest'
import { TOWN_LEARNING_MIN_SAMPLES, evaluateOffer, emptyBusyness, learnTownRatings, learnedRatingAt, levelFromWait, mergeTownRatings, timeBandAt, type LearnOffer } from './index'

const jst = (s: string) => new Date(`${s}+09:00`).toISOString()

describe('時間帯と段階', () => {
  it('時間帯は日本時間・4時区切り（深夜2時は「夜」）', () => {
    expect(timeBandAt(Date.parse(jst('2026-10-05T04:00:00')))).toBe(0)
    expect(timeBandAt(Date.parse(jst('2026-10-05T12:30:00')))).toBe(1)
    expect(timeBandAt(Date.parse(jst('2026-10-05T18:00:00')))).toBe(3)
    expect(timeBandAt(Date.parse(jst('2026-10-06T02:00:00')))).toBe(4)
  })

  it('待ち時間の中央値から段階を出す', () => {
    expect([0, 3, 3.1, 7, 12, 12.5].map(levelFromWait)).toEqual([4, 4, 3, 3, 2, 1])
  })
})

describe('記録から学ぶ', () => {
  it('配達を終える時刻から次のオファーまでを測る。配達中に来たら0分、60分より空いたら数えない', () => {
    const offers: LearnOffer[] = [
      // 18:00 高円寺 20分 → 18:20 に終わり、18:26 に次（断った）→ 6分
      { at: jst('2026-10-05T18:00:00'), minutes: 20, town: '高円寺', outcome: 'accepted' },
      { at: jst('2026-10-05T18:26:00'), minutes: 15, town: '中野', outcome: 'declined' },
      // 18:30 高円寺 20分 → 配達中の 18:40 に次 → 0分
      { at: jst('2026-10-05T18:30:00'), minutes: 20, town: '高円寺', outcome: 'accepted' },
      // 18:40 阿佐谷 15分 → 18:55 に終わり、次は 20:30 → 95分で数えない
      { at: jst('2026-10-05T18:40:00'), minutes: 15, town: '阿佐谷', outcome: 'accepted' },
      // 20:30 地名なし → 数えない
      { at: jst('2026-10-05T20:30:00'), minutes: 10, town: null, outcome: 'accepted' },
      { at: jst('2026-10-05T20:50:00'), minutes: 10, town: '高円寺', outcome: 'declined' },
    ]
    expect(learnTownRatings(offers)).toEqual([{ town: '高円寺', band: 3, samples: 2, medianWaitMinutes: 3, level: 4 }])
  })

  it('10件以上たまった地名×時間帯だけを判定に使い、手で登録した混み具合より優先する', () => {
    const offers: LearnOffer[] = []
    // 平日の夕方、高円寺で受けて、終わって10分後に次が来る（中央値10分 → 段階2）
    for (let i = 0; i < TOWN_LEARNING_MIN_SAMPLES; i++) {
      const start = Date.parse(jst('2026-10-05T17:00:00')) + i * 86_400_000
      offers.push({ at: new Date(start).toISOString(), minutes: 20, town: '高円寺', outcome: 'accepted' })
      offers.push({ at: new Date(start + 30 * 60_000).toISOString(), minutes: 20, town: '中野', outcome: 'declined' })
    }
    const ratings = learnTownRatings(offers)
    const at = Date.parse(jst('2026-10-20T18:00:00'))
    const learned = learnedRatingAt(ratings, '高円寺', at)
    expect(learned).toMatchObject({ samples: 10, medianWaitMinutes: 10, level: 2 })
    expect(learnedRatingAt(ratings, '高円寺', Date.parse(jst('2026-10-20T12:00:00')))).toBeNull()
    expect(learnedRatingAt(learnTownRatings(offers.slice(2)), '高円寺', at)).toBeNull() // 9件

    // 表では「混む」でも、学習した評価（段階2）を使って基準を5%上げる
    const busy = emptyBusyness()
    busy.forEach((day) => day.fill(4))
    const r = evaluateOffer({ payYen: 900, minutes: 20, km: null, at: jst('2026-10-20T17:40:00'), bufferMinutes: 5, targetHourlyYen: 2000, destinationBusyness: busy, destinationLearned: learned })
    expect(r).toMatchObject({ arrivalLevel: 2, arrivalSource: 'learned', thresholdYen: 2100 })
    expect(r.reasons.join()).toContain('「高円寺」の夕方は、これまで10件で次のオファーまで中央値10分')
  })

  it('同じ時刻の記録は「次」に数えず、その後の記録までの待ちを測る', () => {
    const offers: LearnOffer[] = [
      { at: jst('2026-10-05T18:00:00'), minutes: 10, town: '高円寺', outcome: 'accepted' },
      { at: jst('2026-10-05T18:00:00'), minutes: 10, town: '中野', outcome: 'declined' },
      { at: jst('2026-10-05T18:15:00'), minutes: 10, town: '中野', outcome: 'declined' },
    ]
    expect(learnTownRatings(offers)).toEqual([{ town: '高円寺', band: 3, samples: 1, medianWaitMinutes: 5, level: 3 }])
  })

  it('設定コードの評価と Safari の記録の評価をまとめる（同じ地名×時間帯は件数の多い方）', () => {
    const fromCode = [{ town: '高円寺', band: 3, samples: 10, medianWaitMinutes: 10, level: 2 }]
    const local = [
      { town: '高円寺', band: 3, samples: 12, medianWaitMinutes: 2, level: 4 },
      { town: '阿佐谷', band: 1, samples: 3, medianWaitMinutes: 8, level: 2 },
    ]
    expect(mergeTownRatings(fromCode, local)).toEqual(local)
    expect(mergeTownRatings(fromCode, local.slice(1))).toEqual([...fromCode, local[1]])
  })
})
