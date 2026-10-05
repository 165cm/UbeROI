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
  if (r >= 180 && r - b >= 120 && g >= 50 && g <= 150) return true
  return Math.max(r, g, b) - Math.min(r, g, b) <= 16 && v >= 60 && v <= 225
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
 * それぞれの棒の高さを「1段階の高さ（棒の間隔×1.6）」で割って段階にする。読めなければ null
 */
export function readBusyChart(p: Pixels): BusyChartReading | null {
  for (let y = p.height - 1; y >= 0; y--) {
    const row = barRow(segmentsAt(p, y))
    if (!row) continue
    const unit = row.pitch * LEVEL_HEIGHT_PER_PITCH
    const levels: number[] = []
    for (const c of row.centers) {
      const x = Math.round(c)
      let top = y
      while (top > 0 && isBar(p, x, top - 1)) top--
      const level = Math.round((y - top + 1) / unit)
      if (level < 1 || level > 4) return null
      levels.push(level)
    }
    return { levels, weekday: readPageDots(p, y, row) }
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
