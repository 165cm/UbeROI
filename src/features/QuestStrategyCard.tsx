// 計画：🧭 クエスト作戦。日跨ぎのクエストと、その期間のピークタイムのクエストをまとめて、
// 段階（最低・本命）ごとに、残りの日の件数（ピーク＋ほか）・時間・報酬を出す（見込み。実績には入れない）
import { MAIN_QUEST_MIN_HOURS, questStrategy } from '../domain'
import { CardTitle } from '../components/fields'
import { formatYen } from '../format'
import { questWeekItems, type QuestWeekInput } from './QuestWeek'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const
const dayText = (iso: string) => {
  const d = new Date(Date.parse(iso) + 9 * 3_600_000)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}
const clock = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(11, 16)

/** 作戦の軸（日跨ぎ）と、同じサービスのピークを選び、作戦を出す。軸がなければ null */
export function buildStrategy(input: QuestWeekInput, allowed: readonly (readonly [number, number])[] | null) {
  const { items, rate, revenuePerHour } = questWeekItems(input)
  const length = (o: { startsAt: string; endsAt: string }) => (Date.parse(o.endsAt) - Date.parse(o.startsAt)) / 3_600_000
  // 作戦の軸：日をまたぐクエストのうち、先に終わる回
  const main = items.filter((it) => length(it.occ) >= MAIN_QUEST_MIN_HOURS && !it.progress.ended).sort((a, b) => a.occ.endsAt.localeCompare(b.occ.endsAt))[0]
  if (!main) return null
  // 1つの配達が両方に数えられるのは同じサービスのクエストだけ
  const peaks = items.filter((it) => length(it.occ) < MAIN_QUEST_MIN_HOURS && it.q.platform === main.q.platform)
  const toQuest = (it: (typeof items)[number]) => ({ label: it.q.label, startsAt: it.occ.startsAt, endsAt: it.occ.endsAt, rewardMode: it.q.rewardMode, tiers: it.q.tiers, count: it.progress.count })
  const strategy = questStrategy({
    now: input.now,
    main: toQuest(main),
    peaks: peaks.map(toQuest),
    ordersPerHour: rate.rate,
    revenuePerOrderYen: rate.rate > 0 ? revenuePerHour / rate.rate : 0,
    allowed,
  })
  if (strategy.goals.length === 0) return null
  /** 作戦で扱うクエスト（🎯 クエストのための時間では重ねて出さない） */
  const keys = new Set([main, ...peaks].map((it) => `${it.q.id}-${it.occ.index}`))
  return { main, strategy, rate, keys }
}

export type StrategyData = NonNullable<ReturnType<typeof buildStrategy>>

/** 選んでいる目標（未選択・範囲外は本命＝最後の段階） */
export const goalIndexOf = (s: StrategyData['strategy'], picked: number | null) => (picked !== null && picked < s.goals.length ? picked : s.goals.length - 1)

export function QuestStrategyCard({ data, picked, onPick }: { data: StrategyData; picked: number | null; onPick: (i: number) => void }) {
  const { main, strategy: s, rate } = data
  const last = s.goals.length - 1
  const goalName = (i: number) => (i === last ? '本命' : i === 0 ? '最低' : `第${s.goals[i]!.tier}段階`)
  const idx = goalIndexOf(s, picked)
  const g = s.goals[idx]!

  return (
    <section className="card stack" aria-labelledby="strategy-title">
      <CardTitle
        id="strategy-title"
        tip={`「${main.q.label}」の段階ごとに、残りの日（4時区切り）に件数を割り振ります。期間に入る同じサービスのピークタイムのクエスト（${MAIN_QUEST_MIN_HOURS}時間より短いクエスト）は、最後の段階まで取る前提で先に数え、足りない分を残りの日に均等に足します（ピークの前後で）。1つの配達は両方のクエストに数えます。時間は、ピークの時間＋ほかの件数÷1時間の件数（${rate.rate}件/時${rate.source === 'personal' ? '・自分の記録' : '・目安'}）。報酬は、まだ届いていない段階の分です。見込みなので、実績には入りません。`}
      >
        🧭 クエスト作戦（{main.q.label}）
      </CardTitle>
      <div className="segmented" role="tablist" aria-label="目標">
        {s.goals.map((x, i) => (
          <button key={x.tier} type="button" role="tab" aria-selected={i === idx} onClick={() => onPick(i)}>
            {goalName(i)} {x.target}件
          </button>
        ))}
      </div>
      <dl className="stats">
        <div>
          <dt>あと</dt>
          <dd className="big">{g.remaining}件</dd>
        </div>
        <div>
          <dt>時間の目安</dt>
          <dd className="big">{g.hours === null ? '算出不可' : `約${g.hours}h`}</dd>
        </div>
        <div>
          <dt>クエストの報酬</dt>
          <dd>
            {formatYen(g.bonusYen)}
            <span className="hint">（1件 +{formatYen(g.bonusPerOrderYen)}）</span>
          </dd>
        </div>
        <div>
          <dt>売上の見込み（報酬込み）</dt>
          <dd>{formatYen(g.revenueYen)}</dd>
        </div>
      </dl>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={`${goalName(idx)}の日ごとの件数`}>
        <table className="breakdown">
          <thead>
            <tr>
              <th scope="col">日</th>
              <th scope="col">ピーク</th>
              <th scope="col">ほか</th>
              <th scope="col">合計</th>
              <th scope="col">時間</th>
            </tr>
          </thead>
          <tbody>
            {g.days.map((d) => (
              <tr key={d.startsAt}>
                <th scope="row">{dayText(d.startsAt)}</th>
                <td>{d.peakCount}件</td>
                <td>+{d.extraCount}件</td>
                <td>
                  <strong>{d.total}件</strong>
                </td>
                <td>{d.hours === null ? '—' : `${d.hours}h`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.skippedPeaks.length > 0 && (
        <p className="hint">🕒 働ける時間の外のピーク {s.skippedPeaks.length}回は数えていません（設定 → 基本 → 働ける時間）</p>
      )}
      {s.warnings.length > 0 && (
        <ul className="reasons" aria-label="ピークの注意">
          {s.warnings.map((w) => (
            <li key={w.startsAt}>
              ⚠️ {w.label} {dayText(w.startsAt)} {clock(w.startsAt)}〜{clock(w.endsAt)}：1時間{rate.rate}件だと{w.canDo}件。{w.need}件には届きにくいので、早めに入るか前後で足す
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
