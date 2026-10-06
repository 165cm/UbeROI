// クエストの進み具合と、休憩前に返却した場合の節約額
// クエストは見込みであり、達成して確定した額だけを精算の「確定したクエスト」に入れる（実績売上には自動で入れない）
import { parseInstant } from './core'
import { feeFor, type Tariff } from './tariff'

const JST_MS = 9 * 3_600_000
const DAY_MS = 86_400_000

/**
 * 選択制クエストの期間（日本時間 月曜4:00〜金曜4:00、金曜4:00〜月曜4:00）のうち、指定時刻を含むもの。
 */
export function selectiveQuestPeriod(atIso: string): { startsAt: string; endsAt: string; label: string } {
  const jst = parseInstant(atIso) + JST_MS
  // 4:00 を日の区切りにした「営業日」の曜日（0=日〜6=土）
  const shifted = jst - 4 * 3_600_000
  const dayStart = Math.floor(shifted / DAY_MS) * DAY_MS
  const weekday = new Date(dayStart).getUTCDay()
  const daysSinceMonday = (weekday + 6) % 7
  const monday = dayStart - daysSinceMonday * DAY_MS
  const friday = monday + 4 * DAY_MS
  const nextMonday = monday + 7 * DAY_MS
  const [start, end, label] = shifted < friday ? [monday, friday, '平日（月曜4:00〜金曜4:00）'] : [friday, nextMonday, '週末（金曜4:00〜月曜4:00）']
  const toIso = (ms: number) => new Date(ms + 4 * 3_600_000 - JST_MS).toISOString()
  return { startsAt: toIso(start), endsAt: toIso(end), label }
}

/** クエストの繰り返し。none＝1回だけ、daily・weekly・monthly＝最初の期間を同じ長さで毎日・毎週・毎月くり返す */
export type QuestRepeat = 'none' | 'daily' | 'weekly' | 'monthly'

export const QUEST_REPEAT_LABELS: Record<QuestRepeat, string> = { none: 'くり返さない', daily: '毎日', weekly: '毎週', monthly: '毎月' }

/** くり返しの1回分の長さの上限（期間が次の回と重ならないように） */
export const QUEST_REPEAT_MAX_MS: Record<Exclude<QuestRepeat, 'none'>, number> = { daily: DAY_MS, weekly: 7 * DAY_MS, monthly: 28 * DAY_MS }

/** 日本時間の暦で k か月ずらす（31日が無い月は月末にそろえる） */
function addMonthsJst(iso: string, k: number): string {
  const d = new Date(parseInstant(iso) + JST_MS)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + k
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const day = Math.min(d.getUTCDate(), lastDay)
  return new Date(Date.UTC(y, m, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) - JST_MS).toISOString()
}

/** k 回目（最初が0）の期間 */
export function questOccurrence(q: { startsAt: string; endsAt: string; repeat?: QuestRepeat }, k: number): { startsAt: string; endsAt: string } {
  const repeat = q.repeat ?? 'none'
  if (repeat === 'none' || k === 0) return { startsAt: new Date(parseInstant(q.startsAt)).toISOString(), endsAt: new Date(parseInstant(q.endsAt)).toISOString() }
  if (repeat === 'monthly') return { startsAt: addMonthsJst(q.startsAt, k), endsAt: addMonthsJst(q.endsAt, k) }
  const step = (repeat === 'daily' ? 1 : 7) * DAY_MS * k
  return { startsAt: new Date(parseInstant(q.startsAt) + step).toISOString(), endsAt: new Date(parseInstant(q.endsAt) + step).toISOString() }
}

/**
 * 今見せる回：今の回（開始〜終了の間）、なければ次の回。くり返さないクエストは登録した期間のまま。
 * 直前の回が終わって1日以内なら、それも返す（達成分の入れ忘れを防ぐ）
 */
export function questOccurrencesNow(
  q: { startsAt: string; endsAt: string; repeat?: QuestRepeat },
  nowIso: string,
): { current: { startsAt: string; endsAt: string; index: number }; previous: { startsAt: string; endsAt: string; index: number } | null } {
  const now = parseInstant(nowIso)
  if ((q.repeat ?? 'none') === 'none') return { current: { ...questOccurrence(q, 0), index: 0 }, previous: null }
  // 終了が今より後になる最初の回を探す（毎日でも数年分で足りる）
  let k = 0
  const first = parseInstant(q.endsAt)
  if (first <= now) {
    const approx = q.repeat === 'daily' ? DAY_MS : q.repeat === 'weekly' ? 7 * DAY_MS : 28 * DAY_MS
    k = Math.max(0, Math.floor((now - first) / approx) - 1)
    // 概算は月の長さ（28〜31日）でずれるので、前後どちらにも補正する
    while (k > 0 && parseInstant(questOccurrence(q, k - 1).endsAt) > now) k--
    while (parseInstant(questOccurrence(q, k).endsAt) <= now) k++
  }
  const prev = k > 0 ? { ...questOccurrence(q, k - 1), index: k - 1 } : null
  return {
    current: { ...questOccurrence(q, k), index: k },
    previous: prev && now < parseInstant(prev.endsAt) + DAY_MS ? prev : null,
  }
}

export interface QuestTier {
  /** この段階に必要な件数 */
  count: number
  rewardYen: number
}

export interface QuestInput {
  startsAt: string
  endsAt: string
  /** cumulative＝各段階の額は達成時の合計、incremental＝各段階で上乗せされる額 */
  rewardMode: 'cumulative' | 'incremental'
  tiers: QuestTier[]
  /** 記録にない配達（他の端末・手書きなど）を足す、または引く件数 */
  manualOffset: number
}

export interface QuestSessionInput {
  status: 'draft' | 'active' | 'completed'
  returnedAt: string | null
  completedCount: number | null
  /** クエストの対象サービスか */
  eligible: boolean
}

export interface QuestProgress {
  count: number
  /** 件数が未入力の確定記録の数（その分は数えられていない） */
  unknownCountSessions: number
  reachedTier: number
  earnedYen: number
  next: { tier: number; remaining: number; gainYen: number } | null
  /** 期間が終わっている */
  ended: boolean
}

/** 段階の額から、達成した合計と次の上乗せ額を出す（仕様 05：累積なら差分、上乗せならその額） */
function tierGains(mode: QuestInput['rewardMode'], tiers: readonly QuestTier[]): number[] {
  return tiers.map((t, i) => (mode === 'cumulative' ? t.rewardYen - (i === 0 ? 0 : tiers[i - 1]!.rewardYen) : t.rewardYen))
}

export function questProgress(quest: QuestInput, sessions: readonly QuestSessionInput[], nowIso: string): QuestProgress {
  const start = parseInstant(quest.startsAt)
  const end = parseInstant(quest.endsAt)
  let count = quest.manualOffset
  let unknownCountSessions = 0
  for (const s of sessions) {
    if (!s.eligible || s.status !== 'completed' || !s.returnedAt) continue
    const t = parseInstant(s.returnedAt)
    if (t < start || t >= end) continue
    if (s.completedCount === null) unknownCountSessions++
    else count += s.completedCount
  }
  const tiers = [...quest.tiers].sort((a, b) => a.count - b.count)
  const gains = tierGains(quest.rewardMode, tiers)
  let reachedTier = 0
  let earnedYen = 0
  tiers.forEach((t, i) => {
    if (count >= t.count) {
      reachedTier = i + 1
      earnedYen += gains[i]!
    }
  })
  const nextIndex = reachedTier < tiers.length ? reachedTier : -1
  return {
    count,
    unknownCountSessions,
    reachedTier,
    earnedYen,
    next: nextIndex === -1 ? null : { tier: nextIndex + 1, remaining: tiers[nextIndex]!.count - count, gainYen: gains[nextIndex]! },
    ended: parseInstant(nowIso) >= end,
  }
}

export interface BreakAdvice {
  /** 借りたまま休憩して、そのまま乗り続けた場合の、今からの料金 */
  keepYen: number | null
  /** 今返して、休憩のあと借り直した場合の、今からの料金 */
  returnAndReRentYen: number | null
  /** keep − returnAndReRent。正なら返したほうが安い */
  savingYen: number | null
}

/**
 * 休憩前に返却するか。すでに払う分（今までの料金）は両方で同じなので比べない。
 * 借りたまま：F(経過 + 休憩 + 休憩後) − F(経過)。返して借り直す：F(休憩後)（新しい貸出）。
 */
export function breakAdvice(tariff: Tariff, rentalStartAt: string, nowIso: string, breakMinutes: number, afterBreakMinutes: number): BreakAdvice {
  const elapsed = Math.max(0, (parseInstant(nowIso) - parseInstant(rentalStartAt)) / 1000)
  const feeNow = feeFor(tariff, elapsed)
  const feeKeep = feeFor(tariff, elapsed + (breakMinutes + afterBreakMinutes) * 60)
  const feeNew = afterBreakMinutes > 0 ? feeFor(tariff, afterBreakMinutes * 60) : 0
  const keepYen = feeNow === null || feeKeep === null ? null : feeKeep - feeNow
  const returnAndReRentYen = feeNew
  return { keepYen, returnAndReRentYen, savingYen: keepYen === null || returnAndReRentYen === null ? null : keepYen - returnAndReRentYen }
}
