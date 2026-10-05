// 終了までの見通し（docs/spec/docs/02-profitability.md §5.4）。稼働中に終了予定の時刻を決めると、
// 今日のここまで（オファーの記録）・いまのペース・この先の混み具合から、
// 「このまま続ける／休憩して再開／今やめる」のこの先の利益を比べる。すでに稼いだ分は、どれを選んでも同じなので比べない
import { parseInstant } from './core'
import { busyLevelAt, type BusynessTable } from './busyness'
import { feeFor, type Tariff } from './tariff'

export type OutlookAction = 'continue' | 'break' | 'stop'

/** 今日のペースを見込みに反映する割合（半分だけ反映）と、ペースの比の上下限 */
export const PACE_WEIGHT = 0.5
export const PACE_RATIO_MIN = 0.5
export const PACE_RATIO_MAX = 1.5
/** ペースを出すのに必要な、出発からの最短の時間（分） */
export const PACE_MIN_ELAPSED_MINUTES = 45
/** 利益の差がこの額より小さい時は、早く終わる方を勧める（疲れと事故のリスクも考えて） */
export const OUTLOOK_TIE_YEN = 200
/** 休憩の長さの候補（分） */
export const BREAK_CHOICES = [30, 60] as const
/** 休憩の後に、少なくともこれだけ働ける時だけ休憩を候補にする（分） */
export const MIN_WORK_AFTER_BREAK_MINUTES = 30
/** 次のオファーまでの間隔として数える上限（分）。これより空いたら休憩・終了とみなす */
const GAP_CAP_MINUTES = 60

export interface OutlookOffer {
  at: string
  payYen: number
  outcome: 'accepted' | 'declined'
}

export interface OutlookInput {
  now: string
  departedAt: string
  /** 終了予定（配達をやめる時刻）。この後、返却して家へ帰る */
  endAt: string
  /** 今日のこの稼働のオファーの記録（出発の後のもの） */
  offers: readonly OutlookOffer[]
  /** これまでのオファーの記録すべて（普段の間隔を出す） */
  allOffers: readonly OutlookOffer[]
  /** 今日のここまでの売上を手で入れた時（オファーの記録より優先） */
  manualRevenueYen?: number | null
  /** 区間の売上の見込み（普段の日の標準）。混み具合・自分の実績から出す */
  estimate: (startIso: string, endIso: string) => number
  busyness?: BusynessTable | null
  rental?: { tariff: Tariff; startAt: string } | null
  /** やめてから返却するまでの分（レンタル代の計算だけに使う） */
  minutesToReturnBike?: number
  /** やめてから家に着くまでの分（返却の時間を含む。締切の判定に使う） */
  minutesToHome?: number
  homeDeadline?: string | null
  /** 締切の日付を決める時刻（帰宅締切の計算と同じ） */
  deadlineMs?: number | null
  targetHourlyYen: number | null
}

export interface OutlookOption {
  action: OutlookAction
  /** 休憩の長さ（分。休憩の時だけ） */
  breakMinutes: number
  /** この先働く時間（時間） */
  workHours: number
  revenueYen: number
  /** 今やめる場合と比べて増えるレンタル代 */
  rentalYen: number | null
  /** この先の利益（売上 − 増えるレンタル代） */
  profitYen: number | null
  /** 働く時間あたり */
  hourlyYen: number | null
  /** 休憩中に返却して借り直すと安い時 true */
  returnDuringBreak: boolean
}

export interface OutlookResult {
  minutesLeft: number
  soFar: {
    hours: number
    accepted: number
    revenueYen: number | null
    source: 'offers' | 'manual' | null
    hourlyYen: number | null
  }
  /** 今日の売上 ÷ ここまでの時間の普段の見込み（出せない時は null） */
  paceRatio: number | null
  /** 見込みに掛ける倍率（ペースを半分だけ反映） */
  paceFactor: number
  recent: { accepted: number; revenueYen: number }
  minutesSinceLastOffer: number
  /** 普段の、オファーとオファーの間隔の中央値（分。記録が5件未満なら null） */
  typicalGapMinutes: number | null
  /** 今から終了までの1時間ごとの混み具合 */
  timeline: { hour: number; level: number | null }[]
  options: OutlookOption[]
  recommended: OutlookAction
  reasons: string[]
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** 普段のオファーの間隔（中央値・分）。60分より空いたところは数えない。5件未満なら null */
export function typicalOfferGapMinutes(offers: readonly OutlookOffer[]): number | null {
  const times = offers.map((o) => parseInstant(o.at)).sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) {
    const g = (times[i]! - times[i - 1]!) / 60_000
    if (g > 0 && g <= GAP_CAP_MINUTES) gaps.push(g)
  }
  return gaps.length >= 5 ? Math.round(median(gaps) * 10) / 10 : null
}

const JST_MS = 9 * 3_600_000

/**
 * 終了予定（日本時間 HH:mm）の時刻：今から前後12時間のうちのその時刻。
 * 出発の前の時刻を入れても翌日へ送らず（過ぎていれば「終了予定の時刻になりました」）、深夜の時刻は翌日として扱う
 */
export function endTimeMs(nowIso: string, clock: string): number {
  const nowMs = parseInstant(nowIso)
  const [h, m] = clock.split(':').map(Number) as [number, number]
  const d = new Date(nowMs + JST_MS)
  let ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m) - JST_MS
  if (ms <= nowMs - 12 * 3_600_000) ms += 86_400_000
  else if (ms > nowMs + 12 * 3_600_000) ms -= 86_400_000
  return ms
}
const hourOf = (ms: number) => new Date(ms + JST_MS).getUTCHours()

export function evaluateOutlook(input: OutlookInput): OutlookResult {
  const nowMs = parseInstant(input.now)
  const endMs = parseInstant(input.endAt)
  const departedMs = parseInstant(input.departedAt)
  const minutesLeft = Math.max(0, Math.round((endMs - nowMs) / 60_000))
  const reasons: string[] = []

  // ---- 今日のここまで ----
  const accepted = input.offers.filter((o) => o.outcome === 'accepted' && parseInstant(o.at) >= departedMs && parseInstant(o.at) <= nowMs)
  const elapsedHours = Math.max(0, (nowMs - departedMs) / 3_600_000)
  const manual = input.manualRevenueYen ?? null
  const source = manual !== null ? 'manual' : accepted.length > 0 ? 'offers' : null
  const revenueSoFar = manual ?? (accepted.length > 0 ? accepted.reduce((a, o) => a + o.payYen, 0) : null)
  const soFar = {
    hours: Math.round(elapsedHours * 100) / 100,
    accepted: accepted.length,
    revenueYen: revenueSoFar,
    source: source as OutlookResult['soFar']['source'],
    hourlyYen: revenueSoFar !== null && elapsedHours > 0 ? Math.round(revenueSoFar / elapsedHours) : null,
  }

  // ---- いまのペース ----
  let paceRatio: number | null = null
  if (revenueSoFar !== null && elapsedHours * 60 >= PACE_MIN_ELAPSED_MINUTES) {
    const expected = input.estimate(input.departedAt, input.now)
    if (expected > 0) paceRatio = Math.round((revenueSoFar / expected) * 100) / 100
  }
  const clamped = paceRatio === null ? 1 : Math.min(PACE_RATIO_MAX, Math.max(PACE_RATIO_MIN, paceRatio))
  const paceFactor = Math.round((1 + (clamped - 1) * PACE_WEIGHT) * 100) / 100
  if (paceRatio !== null) {
    reasons.push(
      paceRatio < 0.9
        ? `今日はここまで、普段の見込みの${Math.round(paceRatio * 100)}%のペースです（この先の見込みを×${paceFactor}）`
        : paceRatio > 1.1
          ? `今日はここまで、普段の見込みの${Math.round(paceRatio * 100)}%と好調です（この先の見込みを×${paceFactor}）`
          : `今日はここまで、ほぼ普段どおりのペースです（${Math.round(paceRatio * 100)}%）`,
    )
  }
  const recentFrom = nowMs - 3_600_000
  const recentAccepted = accepted.filter((o) => parseInstant(o.at) >= recentFrom)
  const recent = { accepted: recentAccepted.length, revenueYen: recentAccepted.reduce((a, o) => a + o.payYen, 0) }
  const sessionOfferTimes = input.offers.map((o) => parseInstant(o.at)).filter((t) => t >= departedMs && t <= nowMs)
  const lastMs = sessionOfferTimes.length ? Math.max(...sessionOfferTimes) : departedMs
  const minutesSinceLastOffer = Math.round((nowMs - lastMs) / 60_000)
  const typicalGapMinutes = typicalOfferGapMinutes(input.allOffers)
  if (typicalGapMinutes !== null && sessionOfferTimes.length > 0 && minutesSinceLastOffer >= Math.max(15, typicalGapMinutes * 2)) {
    reasons.push(`最後のオファーから${minutesSinceLastOffer}分です（普段の間隔は${typicalGapMinutes}分）`)
  }

  // ---- この先の混み具合 ----
  const timeline: OutlookResult['timeline'] = []
  for (let t = Math.floor((nowMs + JST_MS) / 3_600_000) * 3_600_000 - JST_MS; t < endMs; t += 3_600_000) {
    timeline.push({ hour: hourOf(t), level: input.busyness ? busyLevelAt(input.busyness, t) : null })
  }

  // ---- 選べる行動 ----
  const returnMs = (input.minutesToReturnBike ?? 0) * 60_000
  const rental = input.rental ?? null
  const elapsedRental = rental ? Math.max(0, (nowMs + returnMs - parseInstant(rental.startAt)) / 1000) : 0
  const stopFee = rental ? feeFor(rental.tariff, elapsedRental) : 0
  const option = (action: OutlookAction, breakMinutes: number): OutlookOption => {
    const startMs = nowMs + breakMinutes * 60_000
    const workMs = Math.max(0, endMs - startMs)
    const workHours = workMs / 3_600_000
    const revenueYen = workMs > 0 ? Math.round(input.estimate(new Date(startMs).toISOString(), input.endAt) * paceFactor) : 0
    // 増えるレンタル代：借りたまま＝F(今の経過＋休憩＋働く時間)−F(今の経過)。休憩中に返して借り直す＝F(働く時間)
    let rentalYen: number | null = 0
    let returnDuringBreak = false
    if (rental && workMs > 0) {
      const keepFee = feeFor(rental.tariff, elapsedRental + (breakMinutes * 60_000 + workMs) / 1000)
      const keep = keepFee === null || stopFee === null ? null : keepFee - stopFee
      const reRent = breakMinutes > 0 ? feeFor(rental.tariff, workMs / 1000) : null
      if (reRent !== null && (keep === null || reRent < keep)) {
        rentalYen = reRent
        returnDuringBreak = true
      } else rentalYen = keep
    }
    const profitYen = rentalYen === null ? null : revenueYen - rentalYen
    const hourlyYen = profitYen === null || workHours <= 0 ? null : Math.round(profitYen / workHours)
    return { action, breakMinutes, workHours: Math.round(workHours * 100) / 100, revenueYen, rentalYen, profitYen, hourlyYen, returnDuringBreak }
  }
  // 目標の時給があれば「目標より上回った分」で比べる（目標を下回る時間は、働く価値が低いとみなす）。なければ利益で比べる
  const target = input.targetHourlyYen
  const score = (o: OutlookOption) => (o.profitYen === null ? -Infinity : o.profitYen - (target ?? 0) * o.workHours)
  const options: OutlookOption[] = [option('continue', 0)]
  const breaks = BREAK_CHOICES.filter((b) => minutesLeft - b >= MIN_WORK_AFTER_BREAK_MINUTES).map((b) => option('break', b))
  // 休憩は、比べる値（目標を上回る分）が大きい長さを1つだけ候補にする
  const bestBreak = breaks.reduce<OutlookOption | null>((best, o) => (best === null || score(o) > score(best) ? o : best), null)
  if (bestBreak) options.push(bestBreak)
  const stop: OutlookOption = { action: 'stop', breakMinutes: 0, workHours: 0, revenueYen: 0, rentalYen: 0, profitYen: 0, hourlyYen: null, returnDuringBreak: false }
  options.push(stop)

  // ---- おすすめ ----
  let recommended: OutlookAction = 'stop'
  if (minutesLeft <= 0) {
    reasons.push('終了予定の時刻になりました')
  } else if (input.deadlineMs != null && endMs + (input.minutesToHome ?? 0) * 60_000 > input.deadlineMs) {
    reasons.push(`終了予定のあと家に着くと、帰宅締切（${input.homeDeadline}）を過ぎます。終了予定を早めてください`)
  } else {
    const best = options.reduce((a, b) => (score(b) > score(a) ? b : a))
    // 差が小さい時は、今やめる（早く帰る）方を勧める
    const pick = best !== stop && score(best) - score(stop) < OUTLOOK_TIE_YEN ? stop : best
    recommended = pick.action
    const fmt = (v: number) => `${v.toLocaleString('ja-JP')}円`
    if (pick !== best) reasons.push(`今やめる場合との差が${fmt(OUTLOOK_TIE_YEN)}未満なので、早く帰る方を勧めます`)
    if (target !== null) {
      const cont = options[0]!
      if (cont.hourlyYen !== null && cont.hourlyYen < target) reasons.push(`このまま続けた時の時給 ${fmt(cont.hourlyYen)}/時 は目標 ${fmt(target)}/時 に届きません`)
      else if (cont.hourlyYen !== null) reasons.push(`このまま続けた時の時給 ${fmt(cont.hourlyYen)}/時 は目標 ${fmt(target)}/時 以上です`)
    } else reasons.push('目標の時給が未設定なので、利益の大きさだけで比べています（設定 → 基本）')
    if (bestBreak && recommended === 'break') {
      const resume = timeline.find((t) => t.hour === hourOf(nowMs + bestBreak.breakMinutes * 60_000))
      const nowLevel = timeline[0]?.level ?? null
      if (resume?.level != null && nowLevel !== null && resume.level > nowLevel) reasons.push(`${bestBreak.breakMinutes}分後の${resume.hour}時台は、今より混む見込みです（段階${nowLevel}→${resume.level}）`)
      if (bestBreak.returnDuringBreak) reasons.push('休憩中はレンタルを返して、再開する時に借り直すと安くなります')
    }
  }
  return { minutesLeft, soFar, paceRatio, paceFactor, recent, minutesSinceLastOffer, typicalGapMinutes, timeline, options, recommended, reasons }
}
