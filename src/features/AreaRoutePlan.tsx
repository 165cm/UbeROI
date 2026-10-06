// 計画：時間帯ごとのエリア計画。候補枠の時間を1時間ごとに区切り、混み具合・移動の分・自分の実績から、
// どの時間にどのエリアにいるとよいかの順番を出す（道のルートは出さない。見込みで、実績には入れない）
import { useState } from 'react'
import { ROUTE_MOVE_PENALTY_YEN, estimateRevenue, planAreaRoute, type PastSession, type RouteArea } from '../domain'
import { CardTitle } from '../components/fields'
import { formatYen } from '../format'
import type { AreaRecord, SlotRecord } from '../storage/schema'

const clock = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(11, 16)
const day = (iso: string) => new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' })
const slotText = (s: SlotRecord) => `${day(s.startsAt)} ${clock(s.startsAt)}〜${clock(s.endsAt)}`

export function AreaRoutePlan({
  now,
  slots,
  chosenIds,
  areas,
  primaryId,
  past,
}: {
  now: string
  /** この週の候補枠 */
  slots: SlotRecord[]
  /** おすすめに選ばれた候補枠 */
  chosenIds: ReadonlySet<string>
  areas: AreaRecord[]
  primaryId: string | null
  past: PastSession[]
}) {
  const primary = areas.find((a) => a.id === primaryId)
  // 最初に出す枠：これからのおすすめの枠、なければこれからの枠、なければ最初の枠
  const upcoming = slots.filter((s) => s.endsAt > now)
  const initial = upcoming.find((s) => chosenIds.has(s.id)) ?? upcoming[0] ?? slots[0]
  const [pickedId, setPickedId] = useState<string | null>(null)
  const slot = slots.find((s) => s.id === pickedId) ?? initial

  const others = primary ? areas.filter((a) => a.id !== primary.id && a.moveMinutes && a.moveFromAreaId === primary.id) : []
  const body = (() => {
    if (!primary) return <p className="hint">設定 → エリアで主なエリアを決め、ほかのエリアに主なエリアからの移動の分を入れると、時間ごとにどのエリアにいるとよいかを出します</p>
    if (others.length === 0) return <p className="hint">設定 → エリアで、ほかのエリアに「{primary.name}」からの移動の分を入れると、時間ごとにどのエリアにいるとよいかを出します</p>
    if (!slot) return <p className="hint">候補枠を入れると、その時間のエリアの順番を出します</p>
    const toRoute = (a: AreaRecord, moveMinutes: number): RouteArea => ({
      id: a.id,
      name: a.name,
      moveMinutes,
      levels: a.levels,
      estimate: (s, e) => estimateRevenue(s, e, past, a.levels).revenueYen,
    })
    const route = planAreaRoute(slot.startsAt, slot.endsAt, [toRoute(primary, 0), ...others.map((a) => toRoute(a, a.moveMinutes!))])
    if (!route) return null
    return (
      <>
        <ol className="list route-list" aria-label="エリアの順番">
          {route.stints.map((st) => (
            <li key={st.startsAt} className="stack">
              {st.moveMinutes > 0 && <span className="hint">🚲 {st.areaName}へ移動（{st.moveMinutes}分の目安）</span>}
              <span className="line">
                <strong className="grow">
                  {clock(st.startsAt)}〜{clock(st.endsAt)} {st.areaName}
                  {st.areaId === primary.id && <span className="hint">（主なエリア）</span>}
                </strong>
                <span className="num">{formatYen(st.revenueYen)}</span>
              </span>
              <span className="hint">混み具合 {st.levels.map((l) => `${l.hour}時 ${l.level ?? '·'}`).join('・')}</span>
            </li>
          ))}
        </ol>
        <p role="status">
          {route.moves > 0
            ? `👉 ずっと「${primary.name}」にいるより +${formatYen(route.gainYen)} の見込み（移動${route.moves}回。合計 ${formatYen(route.revenueYen)}）`
            : `ずっと「${primary.name}」にいるのが一番良い見込みです（${formatYen(route.stayYen)}）`}
        </p>
      </>
    )
  })()

  // エリアを1つも登録していない人には出さない（設定 → エリアを使っていない）
  if (areas.length === 0) return null
  return (
    <section className="card stack" aria-labelledby="area-route-title">
      <CardTitle
        id="area-route-title"
        tip={`候補枠の時間を1時間ごとに区切り、どの時間にどのエリアにいると売上の見込みが一番大きいかの順番を出します。各エリアの見込みは、自分の実績（少ない間は目安）をそのエリアの混み具合で補正したものです。「${primary?.name ?? '主なエリア'}」から始める前提で、移動は正時にだけ考え、移動の分はその時間の売上から引きます。主なエリア以外の2つの間は、それぞれの移動の分の合計を目安にします。移動は手間と外れのリスクがあるので、1回あたり${formatYen(ROUTE_MOVE_PENALTY_YEN)}以上良くなる時だけ勧めます。混み具合の段階はエリアの中での比べっこなので、エリア同士の比べ方は目安です。道のルートは出しません。見込みなので、実績には入りません。`}
      >
        🧭 時間帯ごとのエリア計画
      </CardTitle>
      {primary && others.length > 0 && slots.length > 0 && (
        <label className="field">
          <span>どの候補枠で見るか</span>
          <select value={slot?.id ?? ''} onChange={(e) => setPickedId(e.target.value)}>
            {slots.map((s) => (
              <option key={s.id} value={s.id}>
                {slotText(s)}
                {chosenIds.has(s.id) ? '（✅ おすすめ）' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {body}
    </section>
  )
}
