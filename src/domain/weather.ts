// 天気（docs/spec/docs/02-profitability.md §5.11）。計画では4つに分ける：晴れ・くもり・雨・荒天（大雨・強風・雷・雪）。
// 雨は注文が増えて件数・1件の売上が上がる目安。荒天は安全のため作戦に入れない
const HOUR = 3_600_000
const JST = 9 * HOUR

export type PlanWeather = 'clear' | 'cloudy' | 'rain' | 'storm'

export const PLAN_WEATHERS: PlanWeather[] = ['clear', 'cloudy', 'rain', 'storm']
export const PLAN_WEATHER_ICONS: Record<PlanWeather, string> = { clear: '☀️', cloudy: '☁️', rain: '☔', storm: '⛈️' }
export const PLAN_WEATHER_LABELS: Record<PlanWeather, string> = { clear: '晴れ', cloudy: 'くもり', rain: '雨', storm: '荒天' }

/** 雨とみなす1時間の降水量（mm） */
export const RAIN_MM = 0.5
/** 荒天とみなす1時間の降水量（mm）と、平均の風速（m/s。気象庁モデルには突風の値がないため、平均の風速で見る。10m/s は自転車で走りにくい強さ） */
export const STORM_MM = 5
export const STORM_WIND_MS = 10

/** 記録の天気（記録の画面の7つ）を、計画の4つにまとめる。本降りは働いた実績なので雨に数える */
export function planWeatherOfRecord(w: string | null | undefined): PlanWeather | null {
  if (!w) return null
  if (w === 'clear' || w === 'hot') return 'clear'
  if (w === 'cloudy') return 'cloudy'
  if (w === 'light_rain' || w === 'heavy_rain') return 'rain'
  if (w === 'windy' || w === 'snow') return 'storm'
  return null
}

/** 予報の1時間（降水量 mm・平均の風速 m/s・天気コード WMO）から、計画の天気 */
export function classifyHour(precipMm: number | null, windMs: number | null, code: number | null): PlanWeather {
  const mm = precipMm ?? 0
  const wind = windMs ?? 0
  // 雷（95〜99）・雪（71〜77・85〜86）は荒天
  if (mm >= STORM_MM || wind >= STORM_WIND_MS || (code !== null && (code >= 95 || (code >= 71 && code <= 77) || code === 85 || code === 86))) return 'storm'
  if (mm >= RAIN_MM || (code !== null && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)))) return 'rain'
  if (code !== null && code >= 2) return 'cloudy'
  return 'clear'
}

/** 日本時間の日付 YYYY-MM-DD（4時区切りの配達の1日） */
export function businessDate(ms: number): string {
  return new Date(ms + JST - 4 * HOUR).toISOString().slice(0, 10)
}

/** 1日の天気の代表：荒天の時間があれば荒天、雨が3時間以上なら雨、くもりが多ければくもり、ほかは晴れ */
export function dayWeather(hours: readonly PlanWeather[]): PlanWeather | null {
  if (hours.length === 0) return null
  if (hours.includes('storm')) return 'storm'
  if (hours.filter((h) => h === 'rain').length >= 3) return 'rain'
  return hours.filter((h) => h === 'cloudy').length * 2 >= hours.length ? 'cloudy' : 'clear'
}

/** 天気の予報（1時間ごと）。キーは正時の時刻（ms） */
export type HourlyWeather = ReadonlyMap<number, PlanWeather>

/**
 * その時刻の天気：手で直した日（日付→天気）があればそれ、なければ予報。どちらもなければ null（天気を考えない）
 */
export function weatherAt(ms: number, forecast: HourlyWeather | null, overrides: Readonly<Record<string, PlanWeather>> | null | undefined): PlanWeather | null {
  const o = overrides?.[businessDate(ms)]
  if (o) return o
  return forecast?.get(Math.floor(ms / HOUR) * HOUR) ?? null
}

/** 雨の時の倍率の目安（自分の記録が少ない間）：件数×1.5・1件の売上×1.1 */
export const REFERENCE_RAIN_ORDERS = 1.5
export const REFERENCE_RAIN_PER_ORDER = 1.1
/** 自分の倍率を使うのに必要な、晴れ（くもり含む）・雨それぞれの記録の数 */
export const MIN_WEATHER_SAMPLES = 3

export interface WeatherSession {
  weather: PlanWeather | null
  hours: number
  completedCount: number | null
  revenueYen: number
}

export interface WeatherFactors {
  /** 雨の時の、晴れ・くもりに比べた件数の倍率 */
  rainOrders: number
  /** 雨の時の、晴れ・くもりに比べた1件の売上の倍率 */
  rainPerOrder: number
  source: 'personal' | 'reference'
  samples: { dry: number; rain: number }
}

/** 天気の倍率：件数の入った確定記録が、晴れ・くもりと雨それぞれ3回以上あれば自分の比（0.5〜3倍に収める）、なければ目安 */
export function weatherFactors(sessions: readonly WeatherSession[]): WeatherFactors {
  const usable = sessions.filter((s) => s.weather && s.weather !== 'storm' && s.hours > 0 && s.completedCount !== null && s.completedCount > 0)
  const dry = usable.filter((s) => s.weather !== 'rain')
  const rain = usable.filter((s) => s.weather === 'rain')
  const samples = { dry: dry.length, rain: rain.length }
  if (dry.length < MIN_WEATHER_SAMPLES || rain.length < MIN_WEATHER_SAMPLES) {
    return { rainOrders: REFERENCE_RAIN_ORDERS, rainPerOrder: REFERENCE_RAIN_PER_ORDER, source: 'reference', samples }
  }
  const sum = (xs: readonly WeatherSession[], f: (s: WeatherSession) => number) => xs.reduce((a, s) => a + f(s), 0)
  const rate = (xs: readonly WeatherSession[]) => sum(xs, (s) => s.completedCount!) / sum(xs, (s) => s.hours)
  const perOrder = (xs: readonly WeatherSession[]) => sum(xs, (s) => s.revenueYen) / sum(xs, (s) => s.completedCount!)
  const clamp = (v: number) => Math.round(Math.min(3, Math.max(0.5, v)) * 100) / 100
  return { rainOrders: clamp(rate(rain) / rate(dry)), rainPerOrder: clamp(perOrder(rain) / perOrder(dry)), source: 'personal', samples }
}

/** 天気の手直し（日付 → 天気）の形の検証 */
export function weatherOverrideProblems(v: unknown): string[] {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return ['天気の手直しの形が正しくありません']
  for (const [k, w] of Object.entries(v)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !PLAN_WEATHERS.includes(w as PlanWeather)) return ['天気の手直しの形が正しくありません']
  }
  return []
}

