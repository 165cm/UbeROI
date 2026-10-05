// 地名の評価の自動学習（docs/spec/docs/02-profitability.md §5.3）。オファーの記録から、
// 受けた配達を終えてから次のオファーが来るまでの待ち時間を、届け先の地名×時間帯ごとに集める。
// 10件以上たまった地名×時間帯は、手で登録した混み具合の代わりにこの評価を判定に使う
import { parseInstant } from './core'
import { busynessSlot } from './busyness'

/** 時間帯（日本時間。配達の1日は4時始まり）。from 時〜to 時の前まで */
export const TIME_BANDS = [
  { label: '朝', from: 4, to: 10 },
  { label: '昼', from: 10, to: 14 },
  { label: '午後', from: 14, to: 17 },
  { label: '夕方', from: 17, to: 21 },
  { label: '夜', from: 21, to: 28 },
] as const

/** この件数以上たまったら、手で登録した混み具合の代わりに使う */
export const TOWN_LEARNING_MIN_SAMPLES = 10
/** 次のオファーまでこの分数より空いたら、休憩・終了とみなして数えない */
export const OFFER_GAP_CAP_MINUTES = 60
/** 待ち時間の中央値（分）の区切り：3分以下=段階4、7分以下=3、12分以下=2、それより長い=1 */
export const WAIT_LEVEL_LIMITS = [3, 7, 12] as const

/** その時刻が入る時間帯の番号（TIME_BANDS の位置） */
export function timeBandAt(ms: number): number {
  const { hour } = busynessSlot(ms)
  const h = hour < 4 ? hour + 24 : hour
  return TIME_BANDS.findIndex((b) => h >= b.from && h < b.to)
}

/** 待ち時間の中央値（分）から段階（1〜4） */
export function levelFromWait(medianMinutes: number): number {
  const i = WAIT_LEVEL_LIMITS.findIndex((limit) => medianMinutes <= limit)
  return i < 0 ? 1 : 4 - i
}

export interface LearnOffer {
  at: string
  minutes: number
  town: string | null
  outcome: 'accepted' | 'declined'
}

export interface TownRating {
  town: string
  band: number
  samples: number
  /** 次のオファーまでの待ち時間の中央値（分、小数1桁） */
  medianWaitMinutes: number
  level: number
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * 受けたオファー（地名あり）ごとに、配達を終える時刻（時刻＋分）から次のオファー（受けた・断ったどちらも）までの待ちを測る。
 * 配達中に次が来たら0分。次がない・60分より空いた時は数えない。時間帯は配達を終える時刻で決める
 */
export function learnTownRatings(offers: readonly LearnOffer[]): TownRating[] {
  const sorted = offers.map((o) => ({ ...o, ms: parseInstant(o.at) })).sort((a, b) => a.ms - b.ms)
  // 各記録の「次の（時刻が後の）オファー」の位置を、後ろから1回の走査で求める（記録が増えても重くしない）
  const nextIndex: number[] = new Array(sorted.length).fill(-1)
  for (let i = sorted.length - 2; i >= 0; i--) {
    nextIndex[i] = sorted[i + 1]!.ms > sorted[i]!.ms ? i + 1 : nextIndex[i + 1]!
  }
  const waits = new Map<string, { town: string; band: number; values: number[] }>()
  sorted.forEach((o, i) => {
    if (o.outcome !== 'accepted' || !o.town) return
    const next = sorted[nextIndex[i]!]
    if (!next) return
    const doneMs = o.ms + o.minutes * 60_000
    const wait = Math.max(0, (next.ms - doneMs) / 60_000)
    if (wait > OFFER_GAP_CAP_MINUTES) return
    const band = timeBandAt(doneMs)
    const key = `${o.town}\u0000${band}`
    const entry = waits.get(key) ?? { town: o.town, band, values: [] }
    entry.values.push(wait)
    waits.set(key, entry)
  })
  return [...waits.values()]
    .map(({ town, band, values }) => {
      const m = Math.round(median([...values].sort((a, b) => a - b)) * 10) / 10
      return { town, band, samples: values.length, medianWaitMinutes: m, level: levelFromWait(m) }
    })
    .sort((a, b) => b.samples - a.samples || a.town.localeCompare(b.town, 'ja') || a.band - b.band)
}

/** 地名と時刻に合う、10件以上たまった評価（なければ null） */
export function learnedRatingAt(ratings: readonly TownRating[], town: string | null, ms: number): TownRating | null {
  if (!town) return null
  const band = timeBandAt(ms)
  return ratings.find((r) => r.town === town && r.band === band && r.samples >= TOWN_LEARNING_MIN_SAMPLES) ?? null
}

/**
 * 2つの評価の一覧をまとめる。同じ地名×時間帯は件数の多い方を使う
 * （設定コードの評価と、Safari にたまった記録から出した評価。重なった記録を二重に数えないため足し合わせない）
 */
export function mergeTownRatings(a: readonly TownRating[], b: readonly TownRating[]): TownRating[] {
  const merged = new Map<string, TownRating>()
  for (const r of [...a, ...b]) {
    const key = `${r.town}\u0000${r.band}`
    const prev = merged.get(key)
    if (!prev || r.samples > prev.samples) merged.set(key, r)
  }
  return [...merged.values()]
}
