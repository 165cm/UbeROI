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
