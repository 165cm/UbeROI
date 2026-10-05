// エリアの混み具合（配達アプリの「時間帯ごとの傾向」を利用者が手で写したもの）。曜日×1時間×4段階
// 段階は「そのエリアの中での比較」で、時給そのものではない。見込みの倍率としてだけ使う

/** 7曜日（0=日〜6=土）× 24時間（0〜23時）。0 は未入力、1〜4 は空き〜混む */
export type BusynessTable = number[][]

export const BUSY_LEVELS = [1, 2, 3, 4] as const

/** 1日の区切り。配達アプリの表は 4時〜翌3時 で1日なので、0〜3時は前の曜日の表を見る */
export const BUSINESS_DAY_START_HOUR = 4

/**
 * 段階ごとの売上の倍率（参考資料の「ピーク帯＝1.00前後」に合わせた推計の目安）。
 * 自分の実績が10回以上ある時は、この倍率の「比」だけを使って自分の平均を補正する
 */
export const BUSY_LEVEL_FACTORS: Record<number, number> = { 1: 0.6, 2: 0.85, 3: 1.1, 4: 1.35 }

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 表の時間の並び（4時〜翌3時） */
export const BUSINESS_HOURS: number[] = Array.from({ length: 24 }, (_, i) => (i + BUSINESS_DAY_START_HOUR) % 24)

export function emptyBusyness(): BusynessTable {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
}

/** 表の形と値（7×24、0〜4の整数）を確かめる */
export function isBusynessTable(v: unknown): v is BusynessTable {
  return (
    Array.isArray(v) &&
    v.length === 7 &&
    v.every((day) => Array.isArray(day) && day.length === 24 && day.every((x) => Number.isInteger(x) && x >= 0 && x <= 4))
  )
}

const JST_MS = 9 * 3_600_000

/** その時刻（UTCのミリ秒）が、表のどの曜日・何時か（日本時間・4時区切り） */
export function busynessSlot(ms: number): { weekday: number; hour: number } {
  const jst = new Date(ms + JST_MS)
  const hour = jst.getUTCHours()
  const day = jst.getUTCDay()
  return { weekday: hour < BUSINESS_DAY_START_HOUR ? (day + 6) % 7 : day, hour }
}

/** その時刻の段階（未入力なら null） */
export function busyLevelAt(table: BusynessTable, ms: number): number | null {
  const { weekday, hour } = busynessSlot(ms)
  const level = table[weekday]?.[hour] ?? 0
  return level >= 1 && level <= 4 ? level : null
}

/** 入力済みのマスの数 */
export function filledCount(table: BusynessTable): number {
  return table.reduce((n, day) => n + day.filter((x) => x > 0).length, 0)
}

/**
 * 区間 [startMs, endMs) を1時間の区切りで分け、各部分の長さ（時間）× 倍率を足す。
 * 段階が未入力の部分は fallback(その部分の開始ms) の倍率を使う
 */
export function weightedBusyHours(table: BusynessTable, startMs: number, endMs: number, fallback: (ms: number) => number): { weighted: number; coveredHours: number } {
  let weighted = 0
  let coveredHours = 0
  for (let t = startMs; t < endMs; ) {
    const next = Math.min(endMs, (Math.floor((t + JST_MS) / 3_600_000) + 1) * 3_600_000 - JST_MS)
    const h = (next - t) / 3_600_000
    const level = busyLevelAt(table, t)
    if (level !== null) {
      weighted += BUSY_LEVEL_FACTORS[level]! * h
      coveredHours += h
    } else {
      weighted += fallback(t) * h
    }
    t = next
  }
  return { weighted, coveredHours }
}

/** 区間の平均の倍率（未入力の部分は除く）。入力済みの部分がなければ null */
export function averageBusyFactor(table: BusynessTable, startMs: number, endMs: number): number | null {
  const { weighted, coveredHours } = weightedBusyHours(table, startMs, endMs, () => 0)
  return coveredHours > 0 ? weighted / coveredHours : null
}
