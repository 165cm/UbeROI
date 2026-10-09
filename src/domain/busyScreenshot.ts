// 配達アプリの「時間帯ごとの傾向」のスクリーンショットから、24本の棒の段階（1〜4）と曜日を読み取る。
// 画像は端末の中で読むだけで、保存も送信もしない。見た目が変わると読めないので、結果は必ず利用者が確かめてから表に入れる

export interface Pixels {
  width: number
  height: number
  /** RGBA の並び（canvas の getImageData と同じ） */
  data: Uint8ClampedArray
}

export interface BusyChartReading {
  /** 4時〜翌3時の順の24本の段階（1〜4） */
  levels: number[]
  /** 画面下の点（ページ送り）から分かった曜日（0=日〜6=土）。分からなければ null */
  weekday: number | null
  /** 高さの境界付近など、特に目視確認が必要な棒（0〜23） */
  uncertain: number[]
  /** 元画像の棒グラフ部分。拡大して目視確認するために使う */
  bounds: { x: number; y: number; width: number; height: number }
}

/** 棒の数（4時〜翌3時） */
const BARS = 24
/** 1段階の高さ ÷ 棒の間隔（配達アプリの画面で測った比。端末の大きさが変わっても同じ） */
export const LEVEL_HEIGHT_PER_PITCH = 1.6

function brightness(p: Pixels, x: number, y: number): number {
  const i = (y * p.width + x) * 4
  return (p.data[i]! + p.data[i + 1]! + p.data[i + 2]!) / 3
}

/** 棒の色：灰色（色みがない）で、背景より明るく、白い文字より暗い */
function isBar(p: Pixels, x: number, y: number): boolean {
  const i = (y * p.width + x) * 4
  const r = p.data[i]!
  const g = p.data[i + 1]!
  const b = p.data[i + 2]!
  const v = (r + g + b) / 3
  // 今の時間の棒はオレンジ色
  if (r >= 160 && r - b >= 65 && g >= 45 && g <= 190) return true
  return Math.max(r, g, b) - Math.min(r, g, b) <= (v < 60 ? 16 : 28) && v >= 45 && v <= 230
}

interface Segment {
  from: number
  to: number
}

function segmentsAt(p: Pixels, y: number): Segment[] {
  const out: Segment[] = []
  let start = -1
  for (let x = 0; x <= p.width; x++) {
    const on = x < p.width && isBar(p, x, y)
    if (on && start < 0) start = x
    if (!on && start >= 0) {
      if (x - start >= 3) out.push({ from: start, to: x - 1 })
      start = -1
    }
  }
  return out
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

/** 24本の棒が等間隔に並んでいる行か（ちょうど24本・間隔と幅がそろっている） */
function barRow(segs: Segment[]): { centers: number[]; pitch: number } | null {
  if (segs.length !== BARS) return null
  const centers = segs.map((s) => (s.from + s.to) / 2)
  const gaps = centers.slice(1).map((c, i) => c - centers[i]!)
  const pitch = median(gaps)
  const widths = segs.map((s) => s.to - s.from + 1)
  const width = median(widths)
  if (pitch < 4 || gaps.some((g) => Math.abs(g - pitch) > pitch * 0.15)) return null
  if (widths.some((w) => Math.abs(w - width) > Math.max(2, width * 0.25))) return null
  return { centers, pitch }
}

/**
 * 棒グラフを探して読む。下から上へ行を見て、24本がそろう一番下の行を棒の根元とし、
 * 5列の高さの中央値を測り、3段階以上がある時は高さの刻みを補正する。
 * 補正できない時は既知の比率（棒の間隔×1.6）を使う。読めなければ null
 */
export function readBusyChart(p: Pixels): BusyChartReading | null {
  if (p.width < 96 || p.height < 20 || p.data.length !== p.width * p.height * 4) return null
  for (let y = p.height - 1; y >= 0; y--) {
    const row = barRow(segmentsAt(p, y))
    if (!row) continue
    // 中央1列だけの傷・JPEGのにじみに引っ張られないよう5列の中央値を取る。
    const heights = row.centers.map(c => median([-2, -1, 0, 1, 2].map(offset => {
      const x = Math.max(0, Math.min(p.width - 1, Math.round(c + offset * Math.max(1, row.pitch * .06))))
      let top = y
      let gap = 0
      for (let t = y; t >= 0; t--) {
        if (isBar(p, x, t)) { top = t; gap = 0 }
        else if (++gap > Math.max(1, Math.round(row.pitch * .06))) break
      }
      return y - top + 1
    })))
    const prior = row.pitch * LEVEL_HEIGHT_PER_PITCH
    // 異なる3段階以上がある場合だけ、画像内の高さの刻みから補正する。
    // 全部同じ高さの画像を「全部4」と決め打ちしない。
    const candidates = heights.flatMap(h => [1, 2, 3, 4].map(k => h / k)).filter(u => u >= prior * .7 && u <= prior * 1.3)
    const error = (u: number) => heights.reduce((sum, h) => sum + Math.abs(h / u - Math.round(h / u)), 0) / BARS
    const calibrated = candidates.filter(u => {
      const levels = heights.map(h => Math.round(h / u))
      return new Set(levels).size >= 3 && levels.every(l => l >= 1 && l <= 4)
    }).sort((a, b) => error(a) - error(b) || Math.abs(a - prior) - Math.abs(b - prior))[0]
    const unit = calibrated && error(calibrated) < .14 ? calibrated : prior
    const levels = heights.map(h => Math.round(h / unit))
    // 下の装飾を誤検出しても、上にある本来のグラフの探索を続ける。
    if (levels.some(l => l < 1 || l > 4) || error(unit) > .24) continue
    const uncertain = heights.flatMap((h, i) => Math.abs(h / unit - levels[i]!) > .2 ? [i] : [])
    const left = Math.max(0, Math.floor(row.centers[0]! - row.pitch / 2))
    const top = Math.max(0, Math.floor(y - Math.max(...heights) - row.pitch / 2))
    return { levels, weekday: readPageDots(p, y, row), uncertain,
      bounds: { x: left, y: top, width: Math.min(p.width - left, Math.ceil(row.pitch * BARS)), height: Math.min(p.height - top, y - top + Math.ceil(row.pitch)) } }
  }
  return null
}

/** ページ送りの点の間隔 ÷ 棒の間隔（配達アプリの画面で測った比） */
export const DOT_GAP_PER_PITCH = 1.466

/**
 * 棒の下にある7つの点（月〜日のページ送り）のうち、白い点の位置から曜日を出す。
 * 点は画面の真ん中を中心に並ぶ（4つ目が真ん中）。灰色の点は地図と見分けにくいので、白い小さな点だけを探し、
 * 真ん中からの距離で何番目かを決める。白い点が1つに決まらない・点の位置からずれている時は null
 */
function readPageDots(p: Pixels, chartBottom: number, chart: { pitch: number }): number | null {
  const cx = (p.width - 1) / 2
  const gap = chart.pitch * DOT_GAP_PER_PITCH
  const dotMax = Math.max(4, Math.round(chart.pitch * 0.7))
  const white = (x: number, y: number) => brightness(p, x, y) >= 200
  const from = Math.max(0, Math.round(cx - gap * 3.5))
  const to = Math.min(p.width - 1, Math.round(cx + gap * 3.5))
  const found = new Set<number>()
  for (let y = chartBottom + Math.round(chart.pitch * 4); y < Math.min(p.height - 1, chartBottom + chart.pitch * 10); y++) {
    let start = -1
    for (let x = from; x <= to + 1; x++) {
      const on = x <= to && white(x, y)
      if (on && start < 0) start = x
      if (!on && start >= 0) {
        const w = x - start
        const mid = Math.round((start + x - 1) / 2)
        // 点の並ぶ位置にある、小さく丸い（縦と横の長さが近い）白い点だけを数える（地図の文字は位置か形で外れる）
        const page = Math.round((mid - cx) / gap) + 3
        if (w >= 3 && w <= dotMax && page >= 0 && page <= 6 && Math.abs(mid - (cx + (page - 3) * gap)) <= gap * 0.2) {
          let top = y
          while (top > 0 && white(mid, top - 1)) top--
          let bottom = y
          while (bottom < p.height - 1 && white(mid, bottom + 1)) bottom++
          const h = bottom - top + 1
          if (h >= 3 && h <= dotMax && Math.abs(h - w) <= Math.max(2, w * 0.4)) found.add(page)
        }
        start = -1
      }
    }
  }
  if (found.size !== 1) return null
  // 月=0 … 日=6 のページ送りを、0=日〜6=土に直す
  return ([...found][0]! + 1) % 7
}
