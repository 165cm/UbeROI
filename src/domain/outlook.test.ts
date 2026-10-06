// 終了までの見通し：今日のペース・この先の混み具合から、続ける／休憩して再開／今やめるを比べる
import { describe, expect, it } from 'vitest'
import { HELLO_TOKYO_CITY, emptyBusyness, endTimeMs, evaluateOutlook, typicalOfferGapMinutes, type OutlookInput, type OutlookOffer } from './index'

const jst = (s: string) => new Date(`${s}+09:00`).toISOString()
/** 普段の見込み：1時間1,500円（区間の長さに比例） */
const flat = (start: string, end: string) => Math.round(((Date.parse(end) - Date.parse(start)) / 3_600_000) * 1500)

const base: OutlookInput = {
  now: jst('2026-10-05T19:00:00'),
  departedAt: jst('2026-10-05T17:00:00'),
  endAt: jst('2026-10-05T21:00:00'),
  offers: [],
  allOffers: [],
  estimate: flat,
  targetHourlyYen: 1200,
}

describe('今日のここまでとペース', () => {
  it('受けたオファーの報酬を足し、普段の見込みとの比を半分だけ見込みに反映する', () => {
    const offers: OutlookOffer[] = [
      { at: jst('2026-10-05T17:30:00'), payYen: 600, outcome: 'accepted' },
      { at: jst('2026-10-05T18:10:00'), payYen: 900, outcome: 'accepted' },
      { at: jst('2026-10-05T18:20:00'), payYen: 400, outcome: 'declined' },
    ]
    const r = evaluateOutlook({ ...base, offers })
    // 2時間で1,500円 ÷ 見込み3,000円 = 0.5 → ×0.75
    expect(r.soFar).toEqual({ hours: 2, accepted: 2, revenueYen: 1500, source: 'offers', hourlyYen: 750 })
    expect(r.paceRatio).toBe(0.5)
    expect(r.paceFactor).toBe(0.75)
    expect(r.minutesSinceLastOffer).toBe(40)
    expect(r.recent).toEqual({ accepted: 1, revenueYen: 900 })
    // このまま続ける：2時間 × 1,500円 × 0.75 = 2,250円
    expect(r.options[0]).toMatchObject({ action: 'continue', revenueYen: 2250, profitYen: 2250, hourlyYen: 1125 })
    expect(r.reasons[0]).toContain('普段の見込みの50%')
  })

  it('手で入れた売上はオファーの記録より優先。出発から45分未満はペースを出さない', () => {
    expect(evaluateOutlook({ ...base, manualRevenueYen: 4500 })).toMatchObject({ paceRatio: 1.5, paceFactor: 1.25, soFar: { source: 'manual' } })
    expect(evaluateOutlook({ ...base, departedAt: jst('2026-10-05T18:30:00'), manualRevenueYen: 100 })).toMatchObject({ paceRatio: null, paceFactor: 1 })
  })

  it('普段のオファーの間隔（60分より空いたところは除く・5件未満は出さない）', () => {
    const at = (m: number) => ({ at: new Date(Date.parse(jst('2026-10-04T18:00:00')) + m * 60_000).toISOString(), payYen: 500, outcome: 'accepted' as const })
    expect(typicalOfferGapMinutes([0, 6, 12, 20, 26].map(at))).toBeNull()
    expect(typicalOfferGapMinutes([0, 6, 12, 20, 26, 32, 200].map(at))).toBe(6)
  })
})

describe('続ける／休憩して再開／今やめる', () => {
  it('この先が空いてから混むなら、休憩して再開を勧める。休憩中は返却して借り直す方が安い', () => {
    const busy = emptyBusyness()
    busy[1]![19] = 1
    busy[1]![20] = 4
    // 19時台は空き（1時間500円）、20時台は混む（1時間2,500円）
    const estimate = (start: string, end: string) => {
      let yen = 0
      for (let t = Date.parse(start); t < Date.parse(end); t += 60_000) yen += new Date(t).getUTCHours() + 9 === 19 ? 500 / 60 : 2500 / 60
      return Math.round(yen)
    }
    const r = evaluateOutlook({ ...base, estimate, busyness: busy, rental: { tariff: HELLO_TOKYO_CITY, startAt: jst('2026-10-05T18:30:00') } })
    expect(r.timeline).toEqual([{ hour: 19, level: 1 }, { hour: 20, level: 4 }])
    const cont = r.options.find((o) => o.action === 'continue')!
    const pause = r.options.find((o) => o.action === 'break')!
    expect(cont.revenueYen).toBe(3000)
    expect(pause).toMatchObject({ breakMinutes: 60, revenueYen: 2500, returnDuringBreak: true })
    expect(r.recommended).toBe('break')
    expect(r.reasons.join()).toContain('20時台は、今より混む見込みです（段階1→4）')
    expect(r.reasons.join()).toContain('休憩中はレンタルを返して')
  })

  it('目標の時給に届かないなら今やめる。差が小さい時は早く終わる方', () => {
    // 1時間500円の見込み：続けると目標1,200円を下回る
    const low = evaluateOutlook({ ...base, estimate: (s, e) => Math.round(((Date.parse(e) - Date.parse(s)) / 3_600_000) * 500) })
    expect(low.recommended).toBe('stop')
    expect(low.reasons.join()).toContain('目標 1,200円/時 に届きません')
    // 1時間1,250円：目標を上回るのは1時間50円だけ（2時間で100円）→ 200円未満なので今やめる
    const close = evaluateOutlook({ ...base, estimate: (s, e) => Math.round(((Date.parse(e) - Date.parse(s)) / 3_600_000) * 1250) })
    expect(close.recommended).toBe('stop')
    expect(close.reasons.join()).toContain('早く帰る方')
    // 普段どおりなら続ける
    expect(evaluateOutlook(base).recommended).toBe('continue')
  })

  it('終了予定の後に家に着くと締切を過ぎるなら、早めるよう伝える。残りが短いと休憩は候補にしない', () => {
    const late = evaluateOutlook({ ...base, minutesToHome: 30, homeDeadline: '21:00', deadlineMs: Date.parse(jst('2026-10-05T21:00:00')) })
    expect(late.recommended).toBe('stop')
    expect(late.reasons[0]).toContain('帰宅締切（21:00）を過ぎます')
    const short = evaluateOutlook({ ...base, endAt: jst('2026-10-05T19:45:00') })
    expect(short.options.map((o) => o.action)).toEqual(['continue', 'stop'])
  })

  it('締切の判定は家までの分だけを足す（返却の時間は家までの分に含まれる）', () => {
    // 21:00 終了 + 家まで30分 = 21:30 ≦ 締切21:30。返却5分は足さない
    const r = evaluateOutlook({ ...base, minutesToHome: 30, minutesToReturnBike: 5, homeDeadline: '21:30', deadlineMs: Date.parse(jst('2026-10-05T21:30:00')) })
    expect(r.reasons.join()).not.toContain('帰宅締切')
  })
})

describe('終了予定の時刻', () => {
  it('今から前後12時間のうちのその時刻（出発前の時刻を翌日へ送らない・深夜は翌日）', () => {
    const now = jst('2026-10-05T20:50:00')
    expect(new Date(endTimeMs(now, '20:45')).toISOString()).toBe(jst('2026-10-05T20:45:00'))
    expect(new Date(endTimeMs(now, '22:00')).toISOString()).toBe(jst('2026-10-05T22:00:00'))
    expect(new Date(endTimeMs(now, '01:30')).toISOString()).toBe(jst('2026-10-06T01:30:00'))
    expect(new Date(endTimeMs(jst('2026-10-06T00:30:00'), '23:45')).toISOString()).toBe(jst('2026-10-05T23:45:00'))
    // 終了予定を過ぎていれば、残り0分で知らせる
    expect(evaluateOutlook({ ...base, now, endAt: new Date(endTimeMs(now, '20:45')).toISOString() })).toMatchObject({ minutesLeft: 0, recommended: 'stop' })
  })
})
