// 「時間帯ごとの傾向」のスクリーンショットの読み取り。配達アプリの画面と同じ並び・比率の合成画像で確かめる
import { describe, expect, it } from 'vitest'
import { DOT_GAP_PER_PITCH, LEVEL_HEIGHT_PER_PITCH, readBusyChart, type Pixels } from './index'

interface Shot {
  levels: number[]
  /** 白い点の位置（0=月〜6=日）。null なら点を描かない */
  page: number | null
  scale?: number
  /** 今の時間の棒（オレンジ色）の位置 */
  now?: number
}

const SHADES = [0, 200, 160, 110, 75]

/** 幅750の画面（iPhone の標準の倍率）を scale 倍した合成画像 */
function shot({ levels, page, scale = 1, now }: Shot): Pixels {
  const width = Math.round(750 * scale)
  const height = Math.round(1334 * scale)
  const data = new Uint8ClampedArray(width * height * 4)
  const fill = (x0: number, y0: number, x1: number, y1: number, [r, g, b]: number[]) => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(height, Math.round(y1)); y++)
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(width, Math.round(x1)); x++) {
        const i = (y * width + x) * 4
        data[i] = r!
        data[i + 1] = g!
        data[i + 2] = b!
        data[i + 3] = 255
      }
  }
  fill(0, 0, width, height, [40, 48, 62]) // 地図
  fill(50 * scale, 810 * scale, 700 * scale, 1215 * scale, [30, 30, 30]) // 傾向のカード
  fill(80 * scale, 850 * scale, 390 * scale, 880 * scale, [240, 240, 240]) // 見出しの文字（大きな白い塊）
  const pitch = 24.55 * scale
  const unit = pitch * LEVEL_HEIGHT_PER_PITCH
  const base = 1141 * scale
  levels.forEach((level, i) => {
    const x = 78 * scale + i * pitch
    fill(x, base - level * unit, x + 20 * scale, base, i === now ? [234, 88, 12] : [SHADES[level]!, SHADES[level]!, SHADES[level]!])
  })
  fill(84 * scale, base, 86 * scale, base + 8 * scale, [150, 150, 150]) // 目盛り
  if (page !== null) {
    const gap = pitch * DOT_GAP_PER_PITCH
    for (let k = 0; k < 7; k++) {
      const cx = (width - 1) / 2 + (k - 3) * gap
      const v = k === page ? 255 : 100
      fill(cx - 5 * scale, 1288 * scale, cx + 5 * scale, 1298 * scale, [v, v, v])
    }
  }
  return { width, height, data }
}

const SUNDAY = [2, 1, 3, 3, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4]

describe('スクリーンショットの読み取り', () => {
  it('24本の棒の段階と、白い点から曜日を読む（7つ目の点＝日曜）', () => {
    expect(readBusyChart(shot({ levels: SUNDAY, page: 6 }))).toEqual({ levels: SUNDAY, weekday: 0 })
  })

  it('今の時間のオレンジ色の棒も読み、月曜（1つ目の点）を読む', () => {
    const monday = [4, 4, 3, 4, 4, 4, 4, 4, 3, 3, 2, 3, 4, 4, 3, 3, 2, 3, 4, 4, 4, 4, 4, 4]
    expect(readBusyChart(shot({ levels: monday, page: 0, now: 18 }))).toEqual({ levels: monday, weekday: 1 })
  })

  it('端末の大きさが違っても読む（幅1170）。点がなければ曜日は null', () => {
    const r = readBusyChart(shot({ levels: SUNDAY, page: null, scale: 1.56 }))
    expect(r).toEqual({ levels: SUNDAY, weekday: null })
    expect(readBusyChart(shot({ levels: SUNDAY, page: 3, scale: 1.56 }))?.weekday).toBe(4)
  })

  it('棒グラフがない画像は null（推測で埋めない）', () => {
    expect(readBusyChart(shot({ levels: [], page: 2 }))).toBeNull()
    expect(readBusyChart(shot({ levels: SUNDAY.slice(0, 20), page: 2 }))).toBeNull()
  })
})
