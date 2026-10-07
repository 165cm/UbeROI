// リーダーボード（docs/spec/docs/02-profitability.md §5.13）。
// 配達アプリのリーダーボードの画面を利用者が自分で撮ったスクショから、順位と件数だけを読む（他の人の名前・顔写真は読まない・保存しない）。
// 撮った時刻ごとの順位と件数から、終了の時にその順位の人が何件くらいになるかを見込み、「攻める」目標の件数を出す
import { normalizeOcrText } from './questScreenshot'

const HOUR = 3_600_000

export interface LeaderboardRow {
  rank: number
  count: number
}

/** 撮った時点のリーダーボード（順位と件数だけ） */
export interface LeaderboardSnapshot {
  at: string
  myRank: number | null
  myCount: number | null
  rows: LeaderboardRow[]
}

/** 順位の賞金：upToRank 位まで（前の行の順位より下）は rewardYen */
export interface LeaderboardPrize {
  upToRank: number
  rewardYen: number
}

/** 保存しておく撮った時点の数の上限（古いものから消す） */
export const MAX_LEADERBOARD_SNAPSHOTS = 20
/** 読み取る順位の上限 */
export const MAX_LEADERBOARD_RANK = 999

export interface LeaderboardReading {
  rows: LeaderboardRow[]
  me: LeaderboardRow | null
  prizes: LeaderboardPrize[]
  missing: ('rows' | 'me')[]
}

/** 自分の行の目印：「あなた」「自分」、英語の表示の「You」（名前の一部の Young などは自分にしない。区切りに挟まれた語だけ） */
const isMeLine = (raw: string, line: string) => /あなた|自分/.test(line) || /(?:^|[|(:])[yＹ]ou(?=[|):]|$)/i.test(raw)

/** 文字認識の結果から、順位と件数・自分の行・賞金を読む。名前などほかの文字は捨てる */
export function parseLeaderboardText(text: string): LeaderboardReading {
  // 空白は「|」にして残す（名前の最後の数字と件数がくっつかないように）
  // 英字が続く Y（You・Yamada など）は、¥ の読み違いとして直さないように全角の Ｙ にしておく
  const spaced = normalizeOcrText(text.replace(/[ \t　]+/g, '|').replace(/Y(?=[a-z])/g, 'Ｙ')).split('\n')
  const rows = new Map<number, number>()
  const prizes: LeaderboardPrize[] = []
  let me: LeaderboardRow | null = null
  let meNext = false
  for (const raw of spaced) {
    const line = raw.replace(/\|/g, '')
    // 賞金：「1位 ¥5,000」「4〜10位 ¥1,000」
    const prize = line.match(/(\d{1,3})位?(?:〜(\d{1,3}))?位[^¥]*¥([\d,.]+)/)
    if (prize) {
      const yen = Number(prize[3]!.replace(/[,.]/g, ''))
      const upTo = Number(prize[2] ?? prize[1])
      if (Number.isSafeInteger(yen) && upTo >= 1 && upTo <= MAX_LEADERBOARD_RANK) prizes.push({ upToRank: upTo, rewardYen: yen })
      continue
    }
    // 日付・時刻の行（画面の上の時計・期間）は順位ではない
    if (line.includes('¥') || /月|\d:\d{2}/.test(line)) continue
    // 順位と件数：「9位 (名前) 23件」「3. (名前) 31回の配達」「あなた:9位 23件」。
    // 順位の後の「位」か、件数の後の「件・回」のどちらかが要る。件数は行の最後の数（名前の中の数字を拾わないように、後ろから探す）
    const r = raw.match(/^(\D{0,12}?)(\d{1,3})\|?(位|\.|\))?/)
    const tail = raw.match(/(?<=^|\D)(\d{1,4})\|?(件|回)?\D*$/)
    const isMe = isMeLine(raw, line)
    if (r && tail && (r[3] === '位' || tail[2])) {
      const rankEnd = r[0].length
      const rank = Number(r[2])
      const count = Number(tail[1])
      if (rank >= 1 && rank <= MAX_LEADERBOARD_RANK && tail.index! >= rankEnd) {
        if (!rows.has(rank)) rows.set(rank, count)
        if (isMe || meNext) me = { rank, count }
        meNext = false
        continue
      }
    }
    // 「あなた」だけの行は、次の順位の行が自分
    if (isMe) meNext = true
  }
  const sorted = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([rank, count]) => ({ rank, count }))
  prizes.sort((a, b) => a.upToRank - b.upToRank)
  const missing: LeaderboardReading['missing'] = []
  if (sorted.length === 0) missing.push('rows')
  if (!me) missing.push('me')
  return { rows: sorted, me, prizes, missing }
}

/** その順位の賞金（なければ 0） */
export function prizeForRank(prizes: readonly LeaderboardPrize[], rank: number): number {
  const p = [...prizes].sort((a, b) => a.upToRank - b.upToRank).find((x) => rank <= x.upToRank)
  return p?.rewardYen ?? 0
}

export interface RankProjection {
  rank: number
  /** 最後に撮った時の件数 */
  count: number
  /** 終了の時の見込みの件数 */
  atEnd: number
  /** pace＝撮った2回の間の増え方から、ratio＝期間の経った割合から、now＝まだ材料が少ないので今の件数のまま */
  method: 'pace' | 'ratio' | 'now'
}

/** 期間がこの割合より経っていれば、経った割合から見込む */
export const MIN_RATIO_ELAPSED = 0.15

/** その順位の件数の、終了の時の見込み。撮った時点が期間の中のものだけを使う */
export function projectRank(snapshots: readonly LeaderboardSnapshot[], rank: number, startsAt: string, endsAt: string): RankProjection | null {
  const s = Date.parse(startsAt)
  const e = Date.parse(endsAt)
  const usable = snapshots
    .filter((x) => Date.parse(x.at) >= s && Date.parse(x.at) <= e)
    .map((x) => ({ at: Date.parse(x.at), row: x.rows.find((r) => r.rank === rank) }))
    .filter((x): x is { at: number; row: LeaderboardRow } => !!x.row)
    .sort((a, b) => a.at - b.at)
  const last = usable[usable.length - 1]
  if (!last) return null
  const first = usable[0]!
  const left = Math.max(0, e - last.at)
  if (last.at - first.at >= HOUR && last.row.count >= first.row.count) {
    const rate = (last.row.count - first.row.count) / (last.at - first.at)
    return { rank, count: last.row.count, atEnd: Math.max(last.row.count, Math.ceil(last.row.count + rate * left)), method: 'pace' }
  }
  const elapsed = last.at - s
  if (e > s && elapsed / (e - s) >= MIN_RATIO_ELAPSED) {
    return { rank, count: last.row.count, atEnd: Math.max(last.row.count, Math.ceil((last.row.count * (e - s)) / elapsed)), method: 'ratio' }
  }
  return { rank, count: last.row.count, atEnd: last.row.count, method: 'now' }
}

export interface LeaderboardInput {
  snapshots: readonly LeaderboardSnapshot[]
  prizes: readonly LeaderboardPrize[]
  /** 狙う順位（未設定なら、賞金のある一番下の順位か、1つ上の順位） */
  targetRank: number | null
  startsAt: string
  endsAt: string
  /** 今の自分の件数（クエストの件数＝記録と調整から。撮った時の件数より多ければこちら） */
  myCountNow: number | null
}

export interface LeaderboardOutlook {
  /** 最後に撮った時点 */
  at: string
  myRank: number | null
  myCount: number | null
  /** すぐ上の順位（近い順に3つまで）と、今の件数の差 */
  above: { rank: number; count: number; gap: number }[]
  target: {
    rank: number
    /** 終了の時にその順位に入るのに要る件数（見込み＋1） */
    need: number
    /** 今からあと何件 */
    more: number | null
    prizeYen: number
    projection: RankProjection
  } | null
}

/** 狙う順位の既定：賞金のある一番下の順位（そこより下にいる時）、なければ1つ上の順位 */
export function defaultTargetRank(myRank: number | null, prizes: readonly LeaderboardPrize[]): number | null {
  if (myRank === null) return null
  const lastPrize = Math.max(0, ...prizes.filter((p) => p.rewardYen > 0).map((p) => p.upToRank))
  if (lastPrize > 0 && myRank > lastPrize) return lastPrize
  return Math.max(1, myRank - 1)
}

export function leaderboardOutlook(input: LeaderboardInput): LeaderboardOutlook | null {
  const s = Date.parse(input.startsAt)
  const e = Date.parse(input.endsAt)
  const inPeriod = input.snapshots.filter((x) => Date.parse(x.at) >= s && Date.parse(x.at) <= e).sort((a, b) => a.at.localeCompare(b.at))
  const latest = inPeriod[inPeriod.length - 1]
  if (!latest) return null
  const myCount = latest.myCount === null && input.myCountNow === null ? null : Math.max(latest.myCount ?? 0, input.myCountNow ?? 0)
  const myRank = latest.myRank
  const others = latest.rows.filter((r) => r.rank !== myRank)
  const above =
    myRank === null || myCount === null
      ? []
      : others
          .filter((r) => r.rank < myRank)
          .sort((a, b) => b.rank - a.rank)
          .slice(0, 3)
          .map((r) => ({ rank: r.rank, count: r.count, gap: Math.max(0, r.count - myCount) }))
  const rank = input.targetRank ?? defaultTargetRank(myRank, input.prizes)
  let target: LeaderboardOutlook['target'] = null
  if (rank !== null) {
    // 上から入るなら今その順位の人を、すでにその順位以内なら1つ下の人を、終了の時に上回る
    const rival = myRank !== null && myRank <= rank ? rank + 1 : rank
    const projection = projectRank(inPeriod, rival, input.startsAt, input.endsAt)
    if (projection) {
      const need = projection.atEnd + 1
      target = { rank, need, more: myCount === null ? null : Math.max(0, need - myCount), prizeYen: prizeForRank(input.prizes, rank), projection }
    }
  }
  return { at: latest.at, myRank, myCount, above, target }
}

/** 撮った時点を足す（同じ時刻は置き換え。古いものから消して上限まで） */
export function addSnapshot(list: readonly LeaderboardSnapshot[], snap: LeaderboardSnapshot): LeaderboardSnapshot[] {
  return [...list.filter((x) => x.at !== snap.at), snap].sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_LEADERBOARD_SNAPSHOTS)
}

/** リーダーボードの形の検証 */
export function leaderboardProblems(v: unknown): string[] {
  const bad = ['リーダーボードの形が正しくありません']
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return bad
  const lb = v as Record<string, unknown>
  const int = (x: unknown, min: number) => Number.isSafeInteger(x) && (x as number) >= min
  if (!Array.isArray(lb.snapshots) || lb.snapshots.length > MAX_LEADERBOARD_SNAPSHOTS) return bad
  for (const sn of lb.snapshots as unknown[]) {
    if (typeof sn !== 'object' || sn === null) return bad
    const x = sn as Record<string, unknown>
    if (typeof x.at !== 'string' || !Number.isFinite(Date.parse(x.at))) return bad
    if (x.myRank !== null && !int(x.myRank, 1)) return ['自分の順位は1以上の整数で入力してください']
    if (x.myCount !== null && !int(x.myCount, 0)) return ['自分の件数は0以上の整数で入力してください']
    if (!Array.isArray(x.rows)) return bad
    const ranks = new Set<number>()
    for (const r of x.rows as unknown[]) {
      const row = r as Record<string, unknown>
      if (typeof r !== 'object' || r === null || !int(row.rank, 1) || (row.rank as number) > MAX_LEADERBOARD_RANK || !int(row.count, 0)) return ['順位は1以上・件数は0以上の整数で入力してください']
      if (ranks.has(row.rank as number)) return ['同じ順位が2つあります']
      ranks.add(row.rank as number)
    }
  }
  if (!Array.isArray(lb.prizes)) return bad
  for (const p of lb.prizes as unknown[]) {
    const x = p as Record<string, unknown>
    if (typeof p !== 'object' || p === null || !int(x.upToRank, 1) || !int(x.rewardYen, 0)) return ['賞金の順位は1以上・額は0以上の整数で入力してください']
  }
  if (lb.targetRank !== null && !int(lb.targetRank, 1)) return ['狙う順位は1以上の整数で入力してください']
  return []
}
