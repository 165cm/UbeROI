// 天気予報（外部サービス：Open-Meteo の気象庁モデル。2026-10-07 ユーザーが了承）。
// 送るのは主なエリアの中心を小数1桁（約10km）に丸めた緯度・経度だけ。記録・設定・現在地は送らない。
// 計画を開いた時だけ取りに行き、3時間は端末に覚える（届かない時は覚えた分か、手で入れた天気を使う）
import { classifyHour, type PlanWeather } from '../domain'

const STORE_KEY = 'deli-kan:weather'
const TTL_MS = 3 * 3_600_000
const ENDPOINT = 'https://api.open-meteo.com/v1/jma'

export interface Forecast {
  fetchedAt: string
  lat: number
  lng: number
  /** [正時の時刻 ms, 天気] */
  hours: [number, PlanWeather][]
}

/** 送る場所：小数1桁（約10km）に丸める */
export const roundCoord = (v: number) => Math.round(v * 10) / 10

function load(lat: number, lng: number, nowMs: number): Forecast | null {
  try {
    const f = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Forecast | null
    if (f && f.lat === lat && f.lng === lng && nowMs - Date.parse(f.fetchedAt) < TTL_MS) return f
  } catch {
    // 覚えた分が読めなくても、取り直せばよい
  }
  return null
}

/** 覚えている予報（古くても、場所が同じなら使う。届かない時のため） */
export function cachedForecast(center: { lat: number; lng: number }): Forecast | null {
  try {
    const f = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Forecast | null
    return f && f.lat === roundCoord(center.lat) && f.lng === roundCoord(center.lng) ? f : null
  } catch {
    return null
  }
}

export async function fetchForecast(center: { lat: number; lng: number }, nowMs = Date.now()): Promise<Forecast> {
  const lat = roundCoord(center.lat)
  const lng = roundCoord(center.lng)
  const cached = load(lat, lng, nowMs)
  if (cached) return cached
  const url = `${ENDPOINT}?latitude=${lat}&longitude=${lng}&hourly=precipitation,weather_code,wind_gusts_10m&wind_speed_unit=ms&timezone=Asia%2FTokyo&forecast_days=8`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`天気予報を取得できませんでした（${res.status}）`)
  const body = (await res.json()) as {
    hourly?: { time?: string[]; precipitation?: (number | null)[]; weather_code?: (number | null)[]; wind_gusts_10m?: (number | null)[] }
  }
  const h = body.hourly
  if (!h?.time) throw new Error('天気予報の形が想定外です')
  // 時刻は日本時間の "2026-10-10T12:00"（timezone=Asia/Tokyo）
  const hours: [number, PlanWeather][] = h.time.map((t, i) => [
    Date.parse(`${t}:00+09:00`),
    classifyHour(h.precipitation?.[i] ?? null, h.wind_gusts_10m?.[i] ?? null, h.weather_code?.[i] ?? null),
  ])
  const f: Forecast = { fetchedAt: new Date(nowMs).toISOString(), lat, lng, hours }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(f))
  } catch {
    // 覚えられなくても、この画面では使える
  }
  return f
}
