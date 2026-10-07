// リーダーボード：スクショの読み取り（順位と件数だけ・名前は捨てる）と、終了の時の見込み・攻める目標
import { describe, expect, it } from 'vitest'
import { addSnapshot, defaultTargetRank, leaderboardOutlook, leaderboardProblems, parseLeaderboardText, prizeForRank, projectRank, type LeaderboardSnapshot } from './index'

const jst = (s: string) => new Date(`${s}+09:00`).toISOString()
const START = jst('2026-10-09T04:00:00')
const END = jst('2026-10-12T04:00:00')

describe('リーダーボードの画面の読み取り', () => {
  it('順位と件数だけを読み、名前は捨てる。「あなた」の行が自分', () => {
    const text = `午前 12:03 Ol57%
リー ダー ボー ド
10 月 9 日 ( 金 ) 4:00 〜 10 月 12 日 (月 ) 4:00
3 位 山田 太郎 31 件
4 位 Taro2 27 件
5 位 ささき 25 件
8 位 すずき 24 件
あな た
9 位 ちとせ 23 件
1 位 ¥5,000
2 〜 5 位 ¥1.000`
    const r = parseLeaderboardText(text)
    expect(r.rows).toEqual([
      { rank: 3, count: 31 },
      { rank: 4, count: 27 },
      { rank: 5, count: 25 },
      { rank: 8, count: 24 },
      { rank: 9, count: 23 },
    ])
    expect(r.me).toEqual({ rank: 9, count: 23 })
    expect(r.prizes).toEqual([
      { upToRank: 1, rewardYen: 5000 },
      { upToRank: 5, rewardYen: 1000 },
    ])
    expect(r.missing).toEqual([])
    // 名前の文字は結果に残らない
    expect(JSON.stringify(r)).not.toMatch(/山田|Taro|すずき|ちとせ/)
  })

  it('「あなた:9位 23件」の1行・「回の配達」も読む。読めなければ手で入れる', () => {
    expect(parseLeaderboardText('あなた：9位 23件\n3. 名前 31回の配達').rows).toEqual([
      { rank: 3, count: 31 },
      { rank: 9, count: 23 },
    ])
    expect(parseLeaderboardText('あなた：9位 23件').me).toEqual({ rank: 9, count: 23 })
    expect(parseLeaderboardText('クエストの進捗\n40回の乗車 ¥3,770').missing).toEqual(['rows', 'me'])
  })
})

const snap = (at: string, rows: [number, number][], me: [number, number] | null = null): LeaderboardSnapshot => ({
  at: jst(at),
  myRank: me?.[0] ?? null,
  myCount: me?.[1] ?? null,
  rows: rows.map(([rank, count]) => ({ rank, count })),
})

describe('終了の時の見込み', () => {
  it('2回撮っていれば、その間の増え方で見込む', () => {
    const list = [snap('2026-10-10T12:00:00', [[4, 20]]), snap('2026-10-10T18:00:00', [[4, 26]])]
    // 6時間で6件 → 残り34時間で34件
    expect(projectRank(list, 4, START, END)).toEqual({ rank: 4, count: 26, atEnd: 60, method: 'pace' })
  })

  it('1回だけなら、期間の経った割合から。始まってすぐは今の件数のまま', () => {
    // 36時間（半分）で27件 → 54件
    expect(projectRank([snap('2026-10-10T16:00:00', [[4, 27]])], 4, START, END)).toMatchObject({ atEnd: 54, method: 'ratio' })
    expect(projectRank([snap('2026-10-09T08:00:00', [[4, 3]])], 4, START, END)).toMatchObject({ atEnd: 3, method: 'now' })
    // 期間の外で撮ったものは使わない
    expect(projectRank([snap('2026-10-08T16:00:00', [[4, 27]])], 4, START, END)).toBeNull()
  })

  it('上の順位との差と、狙う順位（既定は賞金のある一番下、なければ1つ上）に要る件数', () => {
    const list = [snap('2026-10-10T16:00:00', [[3, 31], [4, 27], [5, 25], [8, 24], [9, 23]], [9, 23])]
    const o = leaderboardOutlook({ snapshots: list, prizes: [], targetRank: null, startsAt: START, endsAt: END, myCountNow: 25 })!
    expect(o.myCount).toBe(25)
    expect(o.above).toEqual([
      { rank: 8, count: 24, gap: 0 },
      { rank: 5, count: 25, gap: 0 },
      { rank: 4, count: 27, gap: 2 },
    ])
    // 1つ上（8位：24件 → 終了で48件）を上回るには49件、今の25件からあと24件
    expect(o.target).toMatchObject({ rank: 8, need: 49, more: 24, prizeYen: 0 })
    const withPrize = leaderboardOutlook({ snapshots: list, prizes: [{ upToRank: 5, rewardYen: 1000 }], targetRank: null, startsAt: START, endsAt: END, myCountNow: null })!
    // 5位（25件 → 50件）を上回る51件
    expect(withPrize.target).toMatchObject({ rank: 5, need: 51, more: 28, prizeYen: 1000 })
  })

  it('すでにその順位以内なら、1つ下の人に抜かれない件数', () => {
    const list = [snap('2026-10-10T16:00:00', [[3, 31], [4, 27]], [3, 31])]
    const o = leaderboardOutlook({ snapshots: list, prizes: [], targetRank: 3, startsAt: START, endsAt: END, myCountNow: null })!
    expect(o.target).toMatchObject({ rank: 3, need: 55, more: 24 })
  })

  it('賞金・狙う順位の既定・撮った時点の上限・形の検証', () => {
    expect(prizeForRank([{ upToRank: 1, rewardYen: 5000 }, { upToRank: 5, rewardYen: 1000 }], 3)).toBe(1000)
    expect(prizeForRank([{ upToRank: 5, rewardYen: 1000 }], 6)).toBe(0)
    expect(defaultTargetRank(1, [])).toBe(1)
    expect(defaultTargetRank(3, [{ upToRank: 5, rewardYen: 1000 }])).toBe(2)
    expect(defaultTargetRank(null, [])).toBeNull()
    let list: LeaderboardSnapshot[] = []
    for (let i = 0; i < 25; i++) list = addSnapshot(list, snap(`2026-10-10T${String(i % 24).padStart(2, '0')}:${i >= 24 ? '30' : '00'}:00`, [[1, i]]))
    expect(list).toHaveLength(20)
    expect(leaderboardProblems({ snapshots: list, prizes: [], targetRank: null })).toEqual([])
    expect(leaderboardProblems({ snapshots: [snap('2026-10-10T12:00:00', [[1, 3], [1, 4]])], prizes: [], targetRank: null })).toEqual(['同じ順位が2つあります'])
    expect(leaderboardProblems({ snapshots: [], prizes: [{ upToRank: 0, rewardYen: 1 }], targetRank: null })).toHaveLength(1)
    expect(leaderboardProblems([])).toHaveLength(1)
  })
})
