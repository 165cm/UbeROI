// エリアの地図（OpenStreetMap）。エリアは配達アプリの形を写さず、中心と半径の円で目安として描く。
// 地図の画像は OpenStreetMap から読み込む（見ている辺りの地図の画像を取りに行くだけで、記録や現在地は送らない）
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { busyAhead, type BusynessTable } from '../domain'

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
/** どこも決まっていない時の表示（日本全体。特定の地域を既定にしない） */
const JAPAN: L.LatLngTuple = [36.5, 138]
const JAPAN_ZOOM = 5

export const RADIUS_CHOICES = [500, 1000, 1500, 2000, 3000, 5000] as const

export interface MapArea {
  id: string
  name: string
  center: { lat: number; lng: number }
  radiusM: number
  levels: BusynessTable
}

function busyColor(level: number | null): string {
  if (level === null) return '#9aa09c'
  return getComputedStyle(document.documentElement).getPropertyValue(`--busy-${level}`).trim() || '#0d9488'
}

function baseMap(el: HTMLElement): L.Map {
  const map = L.map(el, { zoomControl: true, attributionControl: true })
  L.tileLayer(TILE_URL, { maxZoom: 18, attribution: ATTRIBUTION }).addTo(map)
  return map
}

/** ほかのエリアの円がすべて入るように表示する（何もなければ日本全体） */
function fitTo(map: L.Map, circles: { center: { lat: number; lng: number }; radiusM: number }[]) {
  if (circles.length === 0) {
    map.setView(JAPAN, JAPAN_ZOOM)
    return
  }
  const bounds = L.latLngBounds([])
  for (const c of circles) bounds.extend(L.latLng(c.center.lat, c.center.lng).toBounds(c.radiusM * 2))
  map.fitBounds(bounds, { padding: [16, 16] })
}

/** 設定 → エリアの編集：地図をタップして中心を決め、半径を選ぶ */
export function MapPicker({
  center,
  radiusM,
  others,
  onChange,
}: {
  center: { lat: number; lng: number } | null
  radiusM: number
  others: { name: string; center: { lat: number; lng: number }; radiusM: number }[]
  onChange: (center: { lat: number; lng: number } | null, radiusM: number) => void
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const circle = useRef<L.Circle | null>(null)
  const latest = useRef({ radiusM, onChange })
  latest.current = { radiusM, onChange }
  const [locating, setLocating] = useState<string | null>(null)
  /** 円が全部見えるように地図を合わせる（現在地にした時・半径を変えた時。タップした時は動かさない） */
  const showCircle = (c: { lat: number; lng: number }, r: number) => map.current?.fitBounds(L.latLng(c.lat, c.lng).toBounds(r * 2), { padding: [16, 16] })

  useEffect(() => {
    if (!el.current) return
    const m = baseMap(el.current)
    map.current = m
    for (const o of others) {
      L.circle([o.center.lat, o.center.lng], { radius: o.radiusM, color: '#888', weight: 1, fillOpacity: 0.08, interactive: false })
        .bindTooltip(o.name, { permanent: true, direction: 'center', className: 'map-label' })
        .addTo(m)
    }
    fitTo(m, center ? [{ center, radiusM }] : others)
    m.on('click', (e: L.LeafletMouseEvent) => latest.current.onChange({ lat: round(e.latlng.lat), lng: round(e.latlng.lng) }, latest.current.radiusM))
    return () => {
      m.remove()
      map.current = null
      circle.current = null
    }
    // 地図は開いた時に1回だけ作る（中心・半径の変化は下で反映する）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    circle.current?.remove()
    circle.current = center ? L.circle([center.lat, center.lng], { radius: radiusM, color: '#0d9488', weight: 2, fillOpacity: 0.15 }).addTo(m) : null
  }, [center, radiusM])

  return (
    <div className="stack">
      <div ref={el} className="area-map" role="region" aria-label="エリアの場所を決める地図（タップした所が中心になります）" />
      <div className="line wrap">
        <label className="line">
          <span className="nowrap">半径</span>
          <select
            className="inline-select"
            value={radiusM}
            onChange={(e) => {
              const r = Number(e.target.value)
              onChange(center, r)
              if (center) showCircle(center, r)
            }}
          >
            {RADIUS_CHOICES.map((r) => (
              <option key={r} value={r}>{r >= 1000 ? `${r / 1000}km` : `${r}m`}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            if (!('geolocation' in navigator)) {
              setLocating('この端末では現在地を使えません')
              return
            }
            setLocating('現在地を探しています…')
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                const c = { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude) }
                onChange(c, radiusM)
                showCircle(c, radiusM)
                setLocating(null)
              },
              () => setLocating('現在地を使えませんでした。地図をタップして決めてください'),
              { timeout: 10_000 },
            )
          }}
        >
          📍 現在地を中心に
        </button>
        {center && (
          <button type="button" onClick={() => onChange(null, radiusM)}>
            地図から外す
          </button>
        )}
      </div>
      <p className="hint" role="status">
        {locating ?? (center ? `中心：設定済み（半径 ${radiusM >= 1000 ? `${radiusM / 1000}km` : `${radiusM}m`}）` : '中心：未設定（地図をタップして決めてください）')}
      </p>
    </div>
  )
}

/** 小数4桁（約10m）に丸める。細かすぎる位置は残さない */
function round(v: number): number {
  return Math.round(v * 10_000) / 10_000
}

/**
 * ホーム：登録したエリアを、混み具合の色の円で地図に描く。時間のつまみと ▶ で、この先の時間をパラパラ動かす
 */
export function BusyMap({ areas, now, hours = 4 }: { areas: MapArea[]; now: string; hours?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layers = useRef<L.Circle[]>([])
  const [offset, setOffset] = useState(0)
  const [playing, setPlaying] = useState(false)
  const t = Date.parse(now)
  const slots = busyAhead(areas[0]?.levels ?? [], t, hours).map((c) => c.startMs)
  const hourLabel = (i: number) => `${new Date(slots[i]! + 9 * 3_600_000).getUTCHours()}時${i === 0 ? '（今）' : ''}`

  useEffect(() => {
    if (!el.current) return
    const m = baseMap(el.current)
    map.current = m
    fitTo(m, areas)
    return () => {
      m.remove()
      map.current = null
    }
    // 地図は開いた時に1回だけ作る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    for (const l of layers.current) l.remove()
    layers.current = areas.map((a) => {
      const level = busyAhead(a.levels, t, hours)[offset]?.level ?? null
      const color = busyColor(level)
      return L.circle([a.center.lat, a.center.lng], { radius: a.radiusM, color, weight: 2, fillColor: color, fillOpacity: 0.45 })
        .bindTooltip(`${a.name} ${level ?? '·'}`, { permanent: true, direction: 'center', className: 'map-label' })
        .addTo(m)
    })
  }, [areas, t, offset, hours])

  // ▶ 再生中は1秒ごとに次の時間へ（最後まで行ったら最初に戻る）
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => setOffset((o) => (o + 1) % hours), 1000)
    return () => window.clearInterval(id)
  }, [playing, hours])

  return (
    <div className="stack">
      <div ref={el} className="area-map" role="region" aria-label={`混み具合の地図：${hourLabel(offset)}。${areas.map((a) => `${a.name} 段階${busyAhead(a.levels, t, hours)[offset]?.level ?? '未入力'}`).join('、')}`} />
      <div className="line">
        <button type="button" className="icon" aria-label={playing ? '止める' : '時間を進めて動かす'} onClick={() => setPlaying((p) => !p)}>
          {playing ? '⏸' : '▶'}
        </button>
        <input
          className="grow"
          type="range"
          min={0}
          max={hours - 1}
          step={1}
          value={offset}
          aria-label="地図に出す時間"
          aria-valuetext={hourLabel(offset)}
          onChange={(e) => {
            setPlaying(false)
            setOffset(Number(e.target.value))
          }}
        />
        <strong className="num" aria-live="polite">{hourLabel(offset)}</strong>
      </div>
    </div>
  )
}
