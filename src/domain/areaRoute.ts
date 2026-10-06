// 時間帯ごとのエリア計画（docs/spec/docs/02-profitability.md §5.6）。
// 稼働する時間を1時間ごと（日本時間の正時）に区切り、どの時間にどのエリアにいると見込みの売上が一番大きいかの順番を出す。
// 移動の時間はその時間の売上から引き、手間と外れのリスクとして1回200円を差し引いて選ぶ（終了までの見通し §5.4 と同じ）。
// 道のルートは出さない。見込みであり、実績には入れない
import { parseInstant } from './core'
import { busyLevelAt, type BusynessTable } from './busyness'

/** 移動1回の手間と外れのリスク（終了までの見通しの移動と同じ） */
export const ROUTE_MOVE_PENALTY_YEN = 200

export interface RouteArea {
  id: string
  name: string
  /** 主なエリアからの移動の分（主なエリアは0） */
  moveMinutes: number
  levels: BusynessTable
  /** この区間の売上の見込み（混み具合と自分の実績から） */
  estimate: (startsAt: string, endsAt: string) => number
}

export interface RouteStint {
  areaId: string
  areaName: string
  /** 着いた時刻（移動の分を引いた後） */
  startsAt: string
  endsAt: string
  /** ここへ来るまでの移動の分（最初のエリアは0） */
  moveMinutes: number
  revenueYen: number
  /** 区間の各正時の段階（未入力は null） */
  levels: { hour: number; level: number | null }[]
}

export interface AreaRoute {
  stints: RouteStint[]
  /** 順番どおりに動いた時の売上の見込み（移動の分は引いてある。手間の200円は引かない） */
  revenueYen: number
  /** ずっと主なエリアにいた時の売上の見込み */
  stayYen: number
  gainYen: number
  moves: number
}

/** a から b への移動の分。主なエリアを通る目安（主なエリア以外の2つの間は、それぞれの分の合計） */
export function routeMoveMinutes(a: RouteArea, b: RouteArea): number {
  if (a.id === b.id) return 0
  if (a.moveMinutes === 0) return b.moveMinutes
  if (b.moveMinutes === 0) return a.moveMinutes
  return a.moveMinutes + b.moveMinutes
}

const iso = (ms: number) => new Date(ms).toISOString()

/** [start, end) を日本時間の正時で区切る */
function hourSegments(start: number, end: number): [number, number][] {
  const segs: [number, number][] = []
  let s = start
  while (s < end) {
    const next = Math.min(end, Math.floor(s / 3_600_000) * 3_600_000 + 3_600_000)
    segs.push([s, next])
    s = next
  }
  return segs
}

/**
 * 主なエリア（areas[0]、moveMinutes 0）から始める前提で、区間ごとにいるエリアを選ぶ（動的計画法）。
 * 移動は区間の始まり（正時）にだけ考え、移動の分がその区間の長さ以上なら、その移動はしない
 */
export function planAreaRoute(startsAt: string, endsAt: string, areas: readonly RouteArea[]): AreaRoute | null {
  const start = parseInstant(startsAt)
  const end = parseInstant(endsAt)
  if (areas.length === 0 || end <= start) return null
  const segs = hourSegments(start, end)
  const rev = (a: number, i: number, lostMin: number) => {
    const [s, e] = segs[i]!
    const from = s + lostMin * 60_000
    return from >= e ? null : areas[a]!.estimate(iso(from), iso(e))
  }
  // best[i][a]：区間 i をエリア a で終えた時の、手間を引いた最大の値。prev は1つ前の区間のエリア
  const n = areas.length
  const best: number[][] = []
  const prev: number[][] = []
  for (let i = 0; i < segs.length; i++) {
    best.push(new Array<number>(n).fill(-Infinity))
    prev.push(new Array<number>(n).fill(-1))
    for (let a = 0; a < n; a++) {
      const froms = i === 0 ? [0] : [...Array(n).keys()]
      for (const b of froms) {
        const base = i === 0 ? 0 : best[i - 1]![b]!
        if (base === -Infinity) continue
        const move = routeMoveMinutes(areas[b]!, areas[a]!)
        const r = rev(a, i, move)
        if (r === null) continue
        const v = base + r - (b === a ? 0 : ROUTE_MOVE_PENALTY_YEN)
        // 同じ値なら、動かない方（b === a）を選ぶ
        if (v > best[i]![a]! || (v === best[i]![a]! && b === a)) {
          best[i]![a] = v
          prev[i]![a] = b
        }
      }
    }
  }
  // 最後の区間で一番良いエリアから戻る（同じ値なら主なエリア側）
  const last = segs.length - 1
  let a = 0
  for (let k = 1; k < n; k++) if (best[last]![k]! > best[last]![a]!) a = k
  const path: number[] = new Array<number>(segs.length)
  for (let i = last; i >= 0; i--) {
    path[i] = a
    a = prev[i]![a]!
  }

  const stints: RouteStint[] = []
  let revenueYen = 0
  let moves = 0
  path.forEach((ai, i) => {
    const before = i === 0 ? 0 : path[i - 1]!
    const move = routeMoveMinutes(areas[before]!, areas[ai]!)
    const r = rev(ai, i, move) ?? 0
    revenueYen += r
    const [s, e] = segs[i]!
    const hour = new Date(s + 9 * 3_600_000).getUTCHours()
    const level = { hour, level: busyLevelAt(areas[ai]!.levels, s) }
    const cur = stints[stints.length - 1]
    if (cur && cur.areaId === areas[ai]!.id) {
      cur.endsAt = iso(e)
      cur.revenueYen += r
      cur.levels.push(level)
    } else {
      if (move > 0) moves++
      stints.push({ areaId: areas[ai]!.id, areaName: areas[ai]!.name, startsAt: iso(s + move * 60_000), endsAt: iso(e), moveMinutes: move, revenueYen: r, levels: [level] })
    }
  })
  const stayYen = segs.reduce((t, _, i) => t + (rev(0, i, 0) ?? 0), 0)
  return { stints, revenueYen, stayYen, gainYen: revenueYen - stayYen, moves }
}
