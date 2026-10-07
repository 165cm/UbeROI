// 稼働中の「🎯 あと何件？」（🏁 終了までの見通しの中）：今の件数から、クエストの次の段階・リーダーボードの順位まで
// あと何件・何分か、終了予定までに届くか（延ばせば届くか）。計算は src/domain/questPush.ts（§5.14）
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { leaderboardOutlook, ordersPerHour, pushOrdersPerHour, questOccurrencesNow, questProgress, questPushGoals, type Platform } from '../domain'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { weatherSessionsFor } from '../storage/toDomain'

const STORE_KEY = 'deli-kan:quest-push'
interface Stored {
  sessionId: string
  /** ＋／− で直した分（受けたオファーの数への足し引き。後から受けたオファーも数えるため、差だけを覚える） */
  adjust: number
}
function load(sessionId: string, acceptedOffers: number): Stored | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as (Stored & { added?: number }) | null
    if (v?.sessionId !== sessionId) return null
    if (Number.isSafeInteger(v.adjust)) return { sessionId, adjust: v.adjust }
    // 前の版は件数そのもの（added）を覚えていた
    if (Number.isSafeInteger(v.added)) return { sessionId, adjust: v.added! - acceptedOffers }
    return null
  } catch {
    return null
  }
}
function save(v: Stored) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v))
  } catch {
    // 覚えられなくても、この画面では使える
  }
}

const clock = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(11, 16)
function duration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? (m > 0 ? `${h}時間${m}分` : `${h}時間`) : `${m}分`
}

export function QuestPush({
  now,
  sessionId,
  departedAt,
  platform,
  acceptedOffers,
  endAt,
  lastAt,
  revenuePerHourYen,
}: {
  now: string
  sessionId: string
  departedAt: string
  platform: Platform
  /** この稼働で「受けた」と記録したオファーの数（この稼働の件数の初めの値） */
  acceptedOffers: number
  endAt: string
  /** 配達を続けられる最後の時刻（帰宅締切−家までの分）。なければ null */
  lastAt: string | null
  revenuePerHourYen: number
}) {
  const { db } = useData()
  const data = useLiveQuery(async () => ({ quests: await db.quests.toArray(), sessions: await db.sessions.toArray() }), [db])
  const [stored, setStored] = useState<Stored>(() => load(sessionId, acceptedOffers) ?? { sessionId, adjust: 0 })
  // この稼働の件数＝受けたオファーの数＋直した分（0より少なくしない）
  const added = Math.max(0, acceptedOffers + stored.adjust)
  useEffect(() => save(stored), [stored])
  if (!data) return null

  const nowMs = Date.parse(now)
  const items = data.quests
    .filter((q) => q.platform === platform)
    .map((q) => ({ q, occ: questOccurrencesNow(q, now).current }))
    .filter(({ occ }) => Date.parse(occ.startsAt) <= nowMs && nowMs < Date.parse(occ.endsAt))
    .sort((a, b) => a.occ.endsAt.localeCompare(b.occ.endsAt))
  if (items.length === 0) return null

  const rate = ordersPerHour(weatherSessionsFor(data.sessions))
  const sessionMinutes = Math.max(0, (nowMs - Date.parse(departedAt)) / 60_000)
  const pace = pushOrdersPerHour(rate.rate, sessionMinutes, added)
  const step = (d: number) => setStored({ ...stored, adjust: Math.max(-acceptedOffers, added + d - acceptedOffers) })

  return (
    <div className="stack quest-push" role="group" aria-label="あと何件？">
      <p className="line">
        <strong className="grow">🎯 あと何件？</strong>
        <span className="hint">この稼働 {added}件</span>
        <button type="button" className="icon" aria-label="この稼働の件数を1件減らす" disabled={added === 0} onClick={() => step(-1)}>
          −
        </button>
        <button type="button" className="icon" aria-label="この稼働の件数を1件増やす" onClick={() => step(1)}>
          ＋
        </button>
      </p>
      {items.map(({ q, occ }) => {
        const offset = occ.index === 0 ? q.manualOffset : (q.offsets?.[String(occ.index)] ?? 0)
        const p = questProgress(
          { ...q, startsAt: occ.startsAt, endsAt: occ.endsAt, manualOffset: offset },
          data.sessions.map((s) => ({ status: s.status, returnedAt: s.returnedAt, completedCount: s.completedCount, eligible: s.platform === q.platform })),
          now,
        )
        const count = p.count + added
        const board = q.leaderboard ? leaderboardOutlook({ ...q.leaderboard, startsAt: occ.startsAt, endsAt: occ.endsAt, myCountNow: count }) : null
        const r = questPushGoals({
          now,
          endAt,
          lastAt,
          questEndsAt: occ.endsAt,
          count,
          rewardMode: q.rewardMode,
          tiers: q.tiers,
          board,
          baseOrdersPerHour: rate.rate,
          sessionMinutes,
          sessionCount: added,
          revenuePerHourYen,
        })
        const last = Math.max(...q.tiers.map((t) => t.count))
        return (
          <div key={`${q.id}-${occ.index}`} className="subcard stack">
            <p className="line">
              <span className="grow">
                {q.label} <strong className="num">{count}/{last}件</strong>
                {board?.myRank != null && <span className="hint">・🏆{board.myRank}位（{clock(Date.parse(board.at))}時点）</span>}
              </span>
            </p>
            {r.goals.length === 0 ? (
              <p className="hint">全段階を達成しました</p>
            ) : (
              <ul className="list" aria-label={`${q.label}の目標`}>
                {r.goals.map((g) => (
                  <li key={g.target} className="line">
                    <span className="grow">
                      {g.labels.join('・')}：あと<strong>{g.more}件</strong>・{g.minutes === null ? '時間は算出不可' : `約${duration(g.minutes)}`}
                      {g.gainYen > 0 && `・+${formatYen(g.gainYen)}`}
                      {g.hourlyYen !== null && <span className="hint">（{formatYen(g.hourlyYen)}/時）</span>}
                    </span>
                    <span className="tag">
                      {g.reach === 'fits' ? `✅ ${clock(Date.parse(endAt))}までに届く` : g.reach === 'extend' ? `⚠️ ${duration(g.extendMinutes)}延ばすと届く` : '❌ 届かない見込み'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
      <p className="hint">
        1時間 約{pace.rate}件で見込み（{rate.source === 'personal' ? '自分の記録' : '目安'}
        {pace.usesPace ? '・今日のペースを半分反映' : ''}）。届く時刻・延ばす分は、終了予定と帰宅締切（家までの分を引く）で見ます
      </p>
    </div>
  )
}
