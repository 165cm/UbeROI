// 計画を開いた時に、主なエリアの天気予報を取る（Open-Meteo・気象庁モデル）。中心が未設定なら取らない
import { useEffect, useState } from 'react'
import type { HourlyWeather } from '../domain'
import { cachedForecast, fetchForecast } from '../adapters/weather'

export type ForecastState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ok'; forecast: HourlyWeather; fetchedAt: string }
  | { status: 'error'; forecast: HourlyWeather | null; fetchedAt: string | null }

export function useForecast(center: { lat: number; lng: number } | null | undefined): ForecastState {
  const [state, setState] = useState<ForecastState>({ status: center ? 'loading' : 'none' })
  const lat = center?.lat
  const lng = center?.lng
  useEffect(() => {
    if (lat === undefined || lng === undefined) {
      setState({ status: 'none' })
      return
    }
    let alive = true
    setState({ status: 'loading' })
    fetchForecast({ lat, lng })
      .then((f) => alive && setState({ status: 'ok', forecast: new Map(f.hours), fetchedAt: f.fetchedAt }))
      .catch(() => {
        if (!alive) return
        // 届かない時は、覚えている予報（古くても）を使う
        const c = cachedForecast({ lat, lng })
        setState({ status: 'error', forecast: c ? new Map(c.hours) : null, fetchedAt: c?.fetchedAt ?? null })
      })
    return () => {
      alive = false
    }
  }, [lat, lng])
  return state
}
