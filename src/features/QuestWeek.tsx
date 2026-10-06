// 計画：クエストを軸にした週の組み立て。今の件数と、この週に選んだ候補枠から、どの段階まで届きそうか、
// 次の段階まで何時間足せばよいか、その時間はボーナス込みで時給いくらかを出す（見込み。実績には入れない）
import {
  REFERENCE_HOURLY_REVENUE_YEN,
  ordersPerHour,
  planQuest,
  questOccurrence,
  questOccurrencesNow,
  questProgress,
  type PastSession,
} from '../domain'
import { CardTitle } from '../components/fields'
import { formatYen } from '../format'
import type { QuestRecord, SessionRecord } from '../storage/schema'

function periodText(o: { startsAt: string; endsAt: string }): string {
  const f = (iso: string) => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return `${f(o.startsAt)}〜${f(o.endsAt)}`
}

export function QuestWeek({
  now,
  weekStart,
  weekEnd,
  quests,
  sessions,
  past,
  chosenSlots,
  costPerHourYen,
  targetHourlyYen,
  onAddSlot,
}: {
  now: string
  /** 表示している週（日本時間の月曜0時〜翌週月曜0時） */
  weekStart: string
  weekEnd: string
  quests: QuestRecord[]
  sessions: SessionRecord[]
  past: PastSession[]
  /** この週に選んだ（おすすめの）候補枠 */
  chosenSlots: { startsAt: string; endsAt: string }[]
  /** 1時間あたりの費用の見込み（選んだ枠のレンタル代・経費の平均） */
  costPerHourYen: number
  targetHourlyYen: number | null
  onAddSlot: () => void
}) {
  const ws = Date.parse(weekStart)
  const we = Date.parse(weekEnd)
  const nowMs = Date.parse(now)
  // 表示している週に重なる、これからの回をすべて（毎日のクエストなら週の各日の回）
  const from = Math.max(nowMs, ws)
  const items = quests.flatMap((q) => {
    const first = questOccurrencesNow(q, new Date(from).toISOString()).current
    const out: { q: QuestRecord; occ: { startsAt: string; endsAt: string; index: number } }[] = []
    for (let k = first.index; ; k++) {
      const occ = { ...questOccurrence(q, k), index: k }
      if (Date.parse(occ.startsAt) >= we) break
      if (Date.parse(occ.endsAt) > from) out.push({ q, occ })
      if ((q.repeat ?? 'none') === 'none') break
    }
    return out
  })
  if (items.length === 0) return null

  const rate = ordersPerHour(
    sessions.filter((s) => s.status === 'completed').map((s) => ({ hours: (Date.parse(s.returnedAt ?? s.departedAt) - Date.parse(s.departedAt)) / 3_600_000, completedCount: s.completedCount })),
  )
  const pastHours = past.reduce((a, p) => a + p.hours, 0)
  const revenuePerHour = past.length >= 10 && pastHours > 0 ? Math.round(past.reduce((a, p) => a + p.revenueYen, 0) / pastHours) : REFERENCE_HOURLY_REVENUE_YEN

  return (
    <section className="card stack" aria-labelledby="quest-week-title">
      <CardTitle
        id="quest-week-title"
        tip={`今の件数と、この週に選んだ（✅ おすすめの）候補枠から、クエストのどの段階まで届きそうかを出します。1時間あたりの件数は${rate.source === 'personal' ? `自分の確定記録${rate.samples}回の平均` : `目安（件数の入った確定記録が3回以上たまるまで ${rate.rate}件/時）`}、追加の時間の売上は${past.length >= 10 ? '自分の平均の時給' : `目安の ${formatYen(REFERENCE_HOURLY_REVENUE_YEN)}/時`}です。「ボーナス込みの純時給」は、追加の時間の売上から費用（選んだ枠のレンタル代・経費の1時間あたり${formatYen(costPerHourYen)}）を引き、ボーナスを足して時間で割った額です。表の「足す時間」は計画の後にさらに必要な時間、「純時給」はその時間のボーナス込みの純時給です。目標の営業純時給以上なら、候補枠を足す価値があります。見込みなので、実績の売上には入りません。`}
      >
        🎯 クエストから見たこの週
      </CardTitle>
      {items.map(({ q, occ }) => {
        const offset = occ.index === 0 ? q.manualOffset : (q.offsets?.[String(occ.index)] ?? 0)
        const progress = questProgress(
          { ...q, startsAt: occ.startsAt, endsAt: occ.endsAt, manualOffset: offset },
          sessions.map((s) => ({ status: s.status, returnedAt: s.returnedAt, completedCount: s.completedCount, eligible: s.platform === q.platform })),
          now,
        )
        const plan = planQuest({
          now,
          startsAt: occ.startsAt,
          endsAt: occ.endsAt,
          rewardMode: q.rewardMode,
          tiers: q.tiers,
          count: progress.count,
          slots: chosenSlots,
          ordersPerHour: rate.rate,
          revenuePerHourYen: revenuePerHour,
          costPerHourYen,
          targetHourlyYen,
        })
        return (
          <div key={`${q.id}-${occ.index}`} className="subcard stack">
            <div className="line">
              <strong className="grow">{q.label}</strong>
              <span className="hint">{periodText(occ)}</span>
            </div>
            <p>
              今 <strong>{progress.count}件</strong> → 計画（{plan.plannedHours}h）どおりなら <strong>{plan.expectedCount}件</strong>
              {plan.expectedTier > 0 ? `（第${plan.expectedTier}段階まで${plan.expectedBonusYen > 0 ? `・+${formatYen(plan.expectedBonusYen)}` : ''}）` : '（段階に届かない）'}
            </p>
            {(() => {
              // 次に目指す段階（計画で届かない最初の段階、なければ一番上）までのバー：濃い＝今、色＝計画で増える分
              const goal = plan.tiers.find((t) => !t.reachedByPlan) ?? plan.tiers[plan.tiers.length - 1]
              if (!goal) return null
              const pct = (n: number) => `${Math.min(100, (n / goal.count) * 100)}%`
              return (
                <div className="amount-bar" role="img" aria-label={`今${progress.count}件、計画どおりなら${plan.expectedCount}件、第${goal.tier}段階は${goal.count}件`}>
                  <span className="amount-done" style={{ width: pct(progress.count) }} />
                  <span className="amount-plan" style={{ width: `calc(${pct(plan.expectedCount)} - ${pct(progress.count)})` }} />
                </div>
              )
            })()}
            {plan.tiers.length === 0 ? (
              <p className="hint">🎉 全段階を達成しています</p>
            ) : (
              <details>
                <summary>段階ごとの見込み（{plan.tiers.length}段階）</summary>
              <div className="table-scroll" tabIndex={0} role="region" aria-label={`${q.label}の段階ごとの見込み`}>
                <table className="breakdown">
                  <thead>
                    <tr><th scope="col">段階</th><th scope="col">あと</th><th scope="col">足す時間</th><th scope="col">純時給</th></tr>
                  </thead>
                  <tbody>
                    {plan.tiers.map((t) => (
                      <tr key={t.tier} className={plan.worthIt?.tier === t.tier ? 'picked' : undefined}>
                        <th scope="row">第{t.tier}段階<br /><span className="hint">+{formatYen(t.gainYen)}</span></th>
                        <td>{t.remaining}件</td>
                        <td>{t.reachedByPlan ? '✅ 計画で届く' : t.possible ? `${t.extraHours}時間` : '期間内は無理'}</td>
                        <td>{t.extraHourlyYen === null ? '—' : `${formatYen(t.extraHourlyYen)}/時`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </details>
            )}
            {plan.worthIt ? (
              <div className="stack">
                <p role="status">
                  👉 第{plan.worthIt.tier}段階まで、あと<strong>{plan.worthIt.extraHours}時間</strong>足すと、ボーナス込みの純時給が{formatYen(plan.worthIt.extraHourlyYen!)}/時（目標以上）
                </p>
                <button type="button" onClick={onAddSlot}>＋ 候補枠を足す</button>
              </div>
            ) : (
              plan.tiers.some((t) => !t.reachedByPlan) && (
                <p className="hint">
                  {targetHourlyYen === null ? '目標の時給を入れると、時間を足す価値があるかを出します（設定 → 基本）' : 'これ以上時間を足しても、ボーナス込みの純時給は目標に届きません'}
                </p>
              )
            )}
          </div>
        )
      })}
    </section>
  )
}
