// グラフの部品（SVG）。1系列なので凡例は付けず、見出しで何の値かを示す。値は必ず表やツールチップでも読める
import { useEffect, useRef, useState, type ReactNode } from 'react'

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(320)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

function niceStep(range: number, ticks: number): number {
  const raw = range / Math.max(1, ticks)
  const pow = 10 ** Math.floor(Math.log10(raw || 1))
  const n = raw / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}

export interface LinePoint {
  label: string
  value: number
}

/**
 * 折れ線（2px）。0 の線を基準として残し、指・マウスを当てると縦線とツールチップで値を出す。
 */
export function LineChart({ points, format, title, describe }: { points: LinePoint[]; format: (v: number) => string; title: string; describe: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const height = 180
  const pad = { top: 12, right: 12, bottom: 24, left: 64 }
  const values = points.map((p) => p.value)
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const step = niceStep(max - min || 1, 4)
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step || step
  const innerW = Math.max(10, width - pad.left - pad.right)
  const innerH = height - pad.top - pad.bottom
  const x = (i: number) => pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const y = (v: number) => pad.top + ((hi - v) / (hi - lo)) * innerH
  const ticks: number[] = []
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(t)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  const active = hover === null ? null : points[hover]

  const onMove = (clientX: number, rect: DOMRect) => {
    if (points.length === 0) return
    const rel = clientX - rect.left - pad.left
    const i = points.length === 1 ? 0 : Math.round((rel / innerW) * (points.length - 1))
    setHover(Math.max(0, Math.min(points.length - 1, i)))
  }

  return (
    <figure className="chart" ref={ref}>
      <figcaption className="visually-hidden">{describe}</figcaption>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={title}
        onPointerMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-zero' : 'chart-grid'} />
            <text x={pad.left - 6} y={y(t)} className="chart-axis" textAnchor="end" dominantBaseline="middle">
              {format(t)}
            </text>
          </g>
        ))}
        {points.length > 0 && (
          <>
            <text x={pad.left} y={height - 6} className="chart-axis">{points[0]!.label}</text>
            {points.length > 1 && <text x={width - pad.right} y={height - 6} className="chart-axis" textAnchor="end">{last!.label}</text>}
            <path d={path} className="chart-line" />
            <circle cx={x(points.length - 1)} cy={y(last!.value)} r={4} className="chart-dot" />
          </>
        )}
        {active && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} className="chart-cross" />
            <circle cx={x(hover)} cy={y(active.value)} r={5} className="chart-dot" />
          </>
        )}
      </svg>
      <p className="chart-readout" aria-live="polite">
        {active ? `${active.label}：${format(active.value)}` : last ? `最新 ${last.label}：${format(last.value)}` : ''}
      </p>
    </figure>
  )
}

export interface BarRow {
  label: string
  value: number
  /** 売上・利益など、主役の行（色つき）。差し引く費用は灰色 */
  emphasis: boolean
  display: string
}

/** 横棒（最大24px）。長さは絶対値、正負は表示の文字（−／＝）で伝える */
export function BarList({ rows, title }: { rows: BarRow[]; title: string }): ReactNode {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)))
  return (
    <div className="barlist" role="table" aria-label={title}>
      {rows.map((r) => (
        <div key={r.label} className="barlist-row" role="row">
          <span role="rowheader" className="barlist-label">{r.label}</span>
          <span className="barlist-track" aria-hidden="true">
            <span className={`barlist-bar${r.emphasis ? ' strong' : ''}${r.value < 0 ? ' negative' : ''}`} style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} />
          </span>
          <span role="cell" className="barlist-value">{r.display}</span>
        </div>
      ))}
    </div>
  )
}
