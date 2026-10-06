// クエストの画面のスクショの読み取り（文字認識の結果は、実際の画面で端末の文字認識が返した形）
import { describe, expect, it } from 'vitest'
import { normalizeOcrText, parseQuestText } from './index'

const jst = (s: string) => new Date(`${s}+09:00`).toISOString()
const NOW = jst('2026-10-07T00:05:00')

describe('クエストの画面の読み取り', () => {
  it('日跨ぎ：期間（4:00 が 4.00 と読まれても）と段階（件数は足していく・¥ が \\ に、1,170 が 1.170 になっても）', () => {
    const text = `mllpovo 会 午前 12:03 イ 品 似 Ol57% 司 )
ぐ
クエ スト の 進捗 芽
10 月 9 日 ( 金 ) 4.00 へ 10 月 12 日 (月 )
4:00
クエ スト が 開始 され て いま せん
クエ スト の 開始 は 金曜 日 午前 4 時 00 分 で す
らら 40 回 の 乗車 \\3,770
らら 10 回 の 乗車 +\\1.170
詳細
。 東京 エリ ア 内 で 開始 し た 乗車 また は 配達 が 対象
で す 。`
    expect(parseQuestText(text, NOW)).toEqual({
      startsAt: jst('2026-10-09T04:00:00'),
      endsAt: jst('2026-10-12T04:00:00'),
      tiers: [
        { count: 40, rewardYen: 3770 },
        { count: 50, rewardYen: 1170 },
      ],
      missing: [],
    })
  })

  it('ピークタイム：期間が出ていない画面は「開始は水曜日 午後4時30分」から開始を出し、終了は手で入れてもらう', () => {
    const text = `llpovo 全 午前 12:05 イ 品 仏 Ol57% 司 )

を
クエ スト の 開始 は 水曜 日 午後 4 時 30 分 で す

G 1 回 の 乗車 \\100
Q 1 回 の 乗車 +\\\\150
Q 1 回 の 乗車 +\\\\150
Q 1 回 の 乗車 +\\\\200
Q 1 回 の 乗車 +\\\\300
向 | 選 「・ 【 還
ホー ム 発見 売り 上 げ _ 受信 トレ イ _ メニ ュー`
    const r = parseQuestText(text, NOW)
    expect(r.startsAt).toBe(jst('2026-10-07T16:30:00'))
    expect(r.endsAt).toBeNull()
    expect(r.missing).toEqual(['end'])
    expect(r.tiers).toEqual([
      { count: 1, rewardYen: 100 },
      { count: 2, rewardYen: 150 },
      { count: 3, rewardYen: 150 },
      { count: 4, rewardYen: 200 },
      { count: 5, rewardYen: 300 },
    ])
  })

  it('午前12時は0時。今日のもう過ぎた時刻なら来週の同じ曜日。終了の時刻も出ていれば使う', () => {
    const r = parseQuestText('クエストの開始は水曜日午前11時30分です\nクエストの終了は水曜日午後2時00分です', jst('2026-10-07T12:00:00'))
    expect(r.startsAt).toBe(jst('2026-10-14T11:30:00'))
    expect(r.endsAt).toBe(jst('2026-10-07T14:00:00'))
    expect(parseQuestText('開始は木曜日午前12時00分', NOW).startsAt).toBe(jst('2026-10-08T00:00:00'))
  })

  it('何も読み取れなければ、すべて手で入れてもらう。年は今に一番近い年にする', () => {
    expect(parseQuestText('リーダーボード', NOW).missing).toEqual(['start', 'end', 'tiers'])
    expect(parseQuestText('12月30日(水)4:00〜1月2日(土)4:00', jst('2026-12-29T10:00:00'))).toMatchObject({
      startsAt: jst('2026-12-30T04:00:00'),
      endsAt: jst('2027-01-02T04:00:00'),
    })
    expect(normalizeOcrText('１０ 回 の 配達 ＋￥１,０００')).toBe('10回の配達+¥1,000')
  })
})
