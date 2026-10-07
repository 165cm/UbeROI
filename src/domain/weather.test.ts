// 天気：予報の1時間の判定・1日の代表・手で直した日・雨の倍率
import { describe, expect, it } from 'vitest'
import { businessDate, classifyHour, dayWeather, planWeatherOfRecord, weatherAt, weatherFactors, type WeatherSession } from './index'

const ms = (s: string) => Date.parse(`${s}+09:00`)

describe('天気', () => {
  it('予報の1時間：0.5mm 以上は雨、5mm 以上・突風15m/s 以上・雷・雪は荒天、雲が多ければくもり', () => {
    expect(classifyHour(0, 3, 0)).toBe('clear')
    expect(classifyHour(0, 3, 3)).toBe('cloudy')
    expect(classifyHour(0.5, 3, 3)).toBe('rain')
    expect(classifyHour(0.1, 3, 61)).toBe('rain')
    expect(classifyHour(6, 3, 63)).toBe('storm')
    expect(classifyHour(0, 16, 3)).toBe('storm')
    expect(classifyHour(0, 3, 95)).toBe('storm')
    expect(classifyHour(0.2, 3, 73)).toBe('storm')
    expect(classifyHour(null, null, null)).toBe('clear')
  })

  it('記録の天気（7つ）を計画の4つに：本降りは働いた実績なので雨、強風・雪は荒天', () => {
    expect(['clear', 'hot', 'cloudy', 'light_rain', 'heavy_rain', 'windy', 'snow', null].map(planWeatherOfRecord)).toEqual(['clear', 'clear', 'cloudy', 'rain', 'rain', 'storm', 'storm', null])
  })

  it('1日の代表：荒天が1時間でもあれば荒天、雨が3時間以上で雨。日付は4時区切り', () => {
    expect(dayWeather(['clear', 'rain', 'rain', 'clear'])).toBe('clear')
    expect(dayWeather(['clear', 'rain', 'rain', 'rain'])).toBe('rain')
    expect(dayWeather(['cloudy', 'cloudy', 'clear'])).toBe('cloudy')
    expect(dayWeather(['clear', 'storm'])).toBe('storm')
    expect(dayWeather([])).toBeNull()
    expect(businessDate(ms('2026-10-10T03:59:00'))).toBe('2026-10-09')
    expect(businessDate(ms('2026-10-10T04:00:00'))).toBe('2026-10-10')
  })

  it('その時刻の天気：手で直した日が先、なければ予報、どちらもなければ null', () => {
    const forecast = new Map([[ms('2026-10-10T12:00:00'), 'rain' as const]])
    expect(weatherAt(ms('2026-10-10T12:30:00'), forecast, null)).toBe('rain')
    expect(weatherAt(ms('2026-10-10T12:30:00'), forecast, { '2026-10-10': 'clear' })).toBe('clear')
    // 翌2時は前の日（10日）の続き
    expect(weatherAt(ms('2026-10-11T02:00:00'), null, { '2026-10-10': 'rain' })).toBe('rain')
    expect(weatherAt(ms('2026-10-11T12:00:00'), forecast, null)).toBeNull()
  })

  it('雨の倍率：晴れ・くもりと雨の記録がそれぞれ3回以上で自分の比、それまでは目安（件数×1.5・単価×1.1）', () => {
    const dry: WeatherSession = { weather: 'clear', hours: 2, completedCount: 5, revenueYen: 3000 }
    const wet: WeatherSession = { weather: 'rain', hours: 2, completedCount: 8, revenueYen: 5600 }
    expect(weatherFactors([dry, dry, dry, wet, wet])).toMatchObject({ rainOrders: 1.5, rainPerOrder: 1.1, source: 'reference', samples: { dry: 3, rain: 2 } })
    // 晴れ 2.5件/時・1件600円、雨 4件/時・1件700円 → 件数×1.6・単価×1.17
    expect(weatherFactors([dry, dry, dry, wet, wet, wet])).toMatchObject({ rainOrders: 1.6, rainPerOrder: 1.17, source: 'personal' })
  })
})
