// オファー判定：画面の文字の読み取り、実質時給、届け先の混み具合、帰宅締切
import { describe, expect, it } from 'vitest'
import { HELLO_TOKYO_CITY, businessDayStart, decodeOfferConfig, emptyBusyness, encodeOfferConfig, evaluateOffer, findTown, parseOfferText, rentalYenPerMinute } from './index'

describe('画面の文字から報酬・分・km を取り出す', () => {
  it('Uber のオファー画面の文字（例）を読む', () => {
    const text = '配達 (2) 限定\n¥946\nUber 技術サービス契約が適用されます\n合計 24 分 (3.7 km)\n注文品の受け渡し場所は同じです\n承諾'
    expect(parseOfferText(text)).toEqual({ payYen: 946, minutes: 24, km: 3.7 })
  })

  it('全角・円表記・カンマも読む。「合計 N 分」を優先する。読めない値は null', () => {
    expect(parseOfferText('１，２３４円　あと15分以内に承諾　合計 32 分 (５．２ km)')).toEqual({ payYen: 1234, minutes: 32, km: 5.2 })
    expect(parseOfferText('配達のご依頼')).toEqual({ payYen: null, minutes: null, km: null })
  })

  it('登録した地名を探す（長い地名を優先）', () => {
    const areas = [
      { name: '中野', towns: ['中野', '高円寺'] },
      { name: '新宿', towns: ['東中野'] },
    ]
    expect(findTown('お届け先：東中野3丁目', areas)?.area.name).toBe('新宿')
    expect(findTown('高円寺北2丁目', areas)).toMatchObject({ town: '高円寺' })
    expect(findTown('荻窪', areas)).toBeNull()
  })
})

describe('オファーの判定', () => {
  const base = { payYen: 946, minutes: 24, km: 3.7, at: '2026-10-05T12:00:00Z', bufferMinutes: 6, targetHourlyYen: 1500 }

  it('レンタル代（1分あたりの目安）を引いて、余裕を足した時間で実質時給を出す', () => {
    // HELLO：15分160円 → 1分約10.67円 × 30分 = 320円。(946 − 320) ÷ 30分 × 60 = 1,252円/時
    const r = evaluateOffer({ ...base, rentalYenPerMinute: rentalYenPerMinute(HELLO_TOKYO_CITY) })
    expect(r.rentalYen).toBe(320)
    expect(r.hourlyYen).toBe(1252)
    expect(r.perMinuteYen).toBe(39.4)
    expect(r.perKmYen).toBe(256)
    // 基準1,500円の8割（1,200円）以上なので「微妙」
    expect(r.decision).toBe('maybe')
  })

  it('レンタル中なら料金表の差で出す（上限に近いと増えない）', () => {
    // 4時間5分借りている → 上限2,500円に達していて、この先30分は増えない（A05：240:01 で2,500円）
    const r = evaluateOffer({ ...base, rental: { tariff: HELLO_TOKYO_CITY, startAt: '2026-10-05T07:55:00Z' } })
    expect(r.rentalYen).toBe(0)
    expect(r.hourlyYen).toBe(1892)
    expect(r.decision).toBe('accept')
    // 借りて10分なら、この先30分で 160円（10分）→ 320円（40分）に増える分の160円
    const early = evaluateOffer({ ...base, rental: { tariff: HELLO_TOKYO_CITY, startAt: '2026-10-05T11:50:00Z' } })
    expect(early.rentalYen).toBe(160)
  })

  it('届け先が配達を終える頃に混むなら基準を下げ、空いているなら上げる', () => {
    const busy = emptyBusyness()
    busy[1]![21] = 4 // 月曜21時台（12:24Z＝21:24 JST に配達が終わる）
    const quiet = emptyBusyness()
    quiet[1]![21] = 1
    // 実質時給 946÷30×60 ≒ 1,892円 → 目標2,000円：混むなら基準1,800円で受ける、空いているなら2,300円で微妙
    expect(evaluateOffer({ ...base, targetHourlyYen: 2000, destinationBusyness: busy })).toMatchObject({ arrivalLevel: 4, thresholdYen: 1800, decision: 'accept' })
    expect(evaluateOffer({ ...base, targetHourlyYen: 2000, destinationBusyness: quiet })).toMatchObject({ arrivalLevel: 1, thresholdYen: 2300, decision: 'maybe' })
  })

  it('配達後に家へ帰ると締切を過ぎるなら断る。目標が未設定なら「微妙」で時給だけ出す', () => {
    // 21:00 JST から24分 + 家まで40分 = 22:04 > 締切22:00
    const late = evaluateOffer({ ...base, homeDeadline: '22:00', minutesToHome: 40, departedAt: '2026-10-05T09:00:00Z' })
    expect(late.decision).toBe('decline')
    expect(late.reasons[0]).toContain('帰宅締切')
    expect(evaluateOffer({ ...base, targetHourlyYen: null })).toMatchObject({ decision: 'maybe', thresholdYen: null })
  })

  it('出発時刻が分からない時は、その日の配達の始まり（4時）を基準に締切を決める（22時過ぎの22時締切を翌日に送らない）', () => {
    expect(businessDayStart('2026-10-05T13:10:00Z')).toBe('2026-10-04T19:00:00.000Z') // 22:10 → 当日4時
    expect(businessDayStart('2026-10-05T16:00:00Z')).toBe('2026-10-04T19:00:00.000Z') // 翌1:00 → 前日4時
    // 22:10 JST、締切22:00 → 断る（設定コードで開いた時と同じく departedAt なし）
    const r = evaluateOffer({ ...base, at: '2026-10-05T13:10:00Z', homeDeadline: '22:00', minutesToHome: 10 })
    expect(r.decision).toBe('decline')
    // 締切が翌1:30なら、21:00 JST 開始で24分＋10分は間に合う
    expect(evaluateOffer({ ...base, homeDeadline: '01:30', minutesToHome: 10 }).decision).not.toBe('decline')
  })

  it('km単価が下限を下回るなら1段下げる', () => {
    const r = evaluateOffer({ ...base, targetHourlyYen: 1000, minKmYen: 300 })
    expect(r.decision).toBe('maybe')
    expect(r.reasons.join()).toContain('km単価')
  })
})

describe('設定コード（ショートカットの URL に入れる）', () => {
  it('設定を文字列にして、同じ内容に戻せる（日本語の地名・混み具合の表も）', () => {
    const levels = emptyBusyness()
    levels[1]![18] = 4
    levels[6]![3] = 2
    const config = {
      targetHourlyYen: 1500,
      bufferMinutes: 6,
      minKmYen: null,
      rentalYenPerMinute: 10.67,
      homeDeadline: '22:30',
      minutesToHome: 15,
      areas: [{ name: '中野・荻窪エリア', towns: ['高円寺', '阿佐谷'], levels }],
      primaryAreaName: '中野・荻窪エリア',
      createdOn: '2026-10-05',
    }
    const code = encodeOfferConfig(config)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeOfferConfig(code)).toEqual(config)
  })

  it('主なエリアの入っていない前の設定コードも読める（主なエリアは null）', () => {
    const old = btoa(JSON.stringify({ v: 1, t: 1500, b: 5, k: null, r: 10.67, d: null, h: 15, a: [], o: '2026-10-05' }))
    expect(decodeOfferConfig(old)).toMatchObject({ primaryAreaName: null, targetHourlyYen: 1500 })
  })

  it('壊れた・版の違う設定コードは null', () => {
    expect(decodeOfferConfig('こわれた')).toBeNull()
    expect(decodeOfferConfig(btoa(JSON.stringify({ v: 99 })))).toBeNull()
  })
})
