// 計画の一番上：この週の稼働量を決めるための材料をひと目で出す。
// ① 稼働の量（実績・これからの予定・週の上限）、② 7日の帯（混み具合の色の上に、予定と実績）、③ 空いている稼げそうな時間
import { busyLevelAt, type BusynessTable, type SuggestedWindow } from '../domain'
import { CardTitle } from '../components/fields'
import { formatYen } from '../format'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const
/** 帯は 4時〜翌4時（配達の1日） */
const DAY_START_HOUR = 4
const AXIS = [4, 8, 12, 16, 20, 24] as const

export interface BoardSlot {
  id: string
  startsAt: string
  endsAt: string
  chosen: boolean
  label: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const hm = (ms: number) => {
  const d = new Date(ms)
  return `${d.getHours()}:${pad(d.getMinutes())}`
}
const fmtH = (h: number) => `${Math.round(h * 10) / 10}h`
const overlapH = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / HOUR

export function WeekBoard({
  now,
  weekFrom,
  slots,
  done,
  budgetHours,
  profitYen,
  busyness,
  suggestions,
  onAdd,
  onEdit,
  onAddSuggestion,
}: {
  now: string
  /** 週の月曜（YYYY-MM-DD・端末の日付） */
  weekFrom: string
  slots: BoardSlot[]
  /** この週の確定した稼働（出発〜帰宅） */
  done: { startsAt: string; endsAt: string }[]
  budgetHours: number | null
  /** 選んだ枠の見込み利益（選んでいる見込み） */
  profitYen: number | null
  busyness: BusynessTable | null
  suggestions: SuggestedWindow[]
  onAdd: (date: string) => void
  onEdit: (id: string) => void
  onAddSuggestion: (w: SuggestedWindow) => void
}) {
  const nowMs = Date.parse(now)
  const weekStart = new Date(`${weekFrom}T00:00`).getTime()
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const start = new Date(`${date}T${pad(DAY_START_HOUR)}:00`).getTime()
    return { date, start, end: start + DAY, label: `${WEEKDAYS[d.getDay()]} ${d.getDate()}` }
  })
  const weekEnd = days[6]!.end
  const range = (x: { startsAt: string; endsAt: string }) => [Date.parse(x.startsAt), Date.parse(x.endsAt)] as const

  const doneHours = done.reduce((a, x) => a + overlapH(...range(x), weekStart, weekEnd), 0)
  const plannedHours = slots.filter((s) => s.chosen).reduce((a, s) => a + overlapH(...range(s), Math.max(nowMs, weekStart), weekEnd), 0)
  const total = doneHours + plannedHours
  const left = budgetHours === null ? null : Math.max(0, budgetHours - total)
  const scale = Math.max(budgetHours ?? 0, total, 1)
  const pct = (h: number) => `${(h / scale) * 100}%`

  return (
    <>
      <section className="card stack" aria-labelledby="week-amount-title">
        <CardTitle
          id="week-amount-title"
          tip="実績は、この週の確定した稼働（出発〜帰宅）。これからは、✅ おすすめに選ばれた候補枠の、今より後の時間です。上限は 設定 → 基本 の「週に使える時間」。見込み利益は、選んだ枠の見込みの売上から費用と固定費を引いた額です（見込み。実績には入りません）。"
        >
          ⏱️ この週の稼働
        </CardTitle>
        <dl className="stats week-amount">
          <div>
            <dt>実績</dt>
            <dd className="big">{fmtH(doneHours)}</dd>
          </div>
          <div>
            <dt>これから</dt>
            <dd className="big accent">{fmtH(plannedHours)}</dd>
          </div>
          <div>
            <dt>{budgetHours === null ? '上限' : '上限まで'}</dt>
            <dd className="big">{left === null ? '未設定' : fmtH(left)}</dd>
          </div>
        </dl>
        <div
          className="amount-bar"
          role="img"
          aria-label={`実績${fmtH(doneHours)}、これから${fmtH(plannedHours)}${budgetHours === null ? '' : `、上限${fmtH(budgetHours)}`}`}
        >
          <span className="amount-done" style={{ width: pct(doneHours) }} />
          <span className="amount-plan" style={{ width: pct(plannedHours) }} />
          {budgetHours !== null && total > budgetHours && <span className="amount-over" style={{ left: pct(budgetHours) }} />}
        </div>
        <p className="line">
          <span className="grow hint">{budgetHours === null ? '設定 → 基本で「週に使える時間」を入れると、上限までの残りが出ます' : total > budgetHours ? '⚠️ 上限を超えています' : `上限 ${fmtH(budgetHours)}`}</span>
          <span>
            見込み利益 <strong className="num">{profitYen === null ? '算出不可' : formatYen(profitYen)}</strong>
          </span>
        </p>
      </section>

      <section className="card stack" aria-labelledby="week-board-title">
        <CardTitle
          id="week-board-title"
          tip="1行が1日（4時〜翌4時）です。帯の色は主なエリアの混み具合（緑＝混む・稼げる、赤＝空き）。濃い四角が ✅ おすすめの予定、点線は選ばれなかった候補、灰色は実績です。四角を押すと編集、＋でその日に候補枠を足せます。"
          right={
            <button type="button" className="icon" aria-label="候補枠を追加" onClick={() => onAdd(days.find((d) => d.end > nowMs)?.date ?? weekFrom)}>
              ＋
            </button>
          }
        >
          📅 いつ働くか
        </CardTitle>
        <div className="wb">
          <div className="wb-axis" aria-hidden="true">
            {AXIS.map((h) => (
              <span key={h} style={{ left: `${((h - DAY_START_HOUR) / 24) * 100}%` }}>
                {h % 24}
              </span>
            ))}
          </div>
          <ul className="wb-days" aria-label="この週の予定">
            {days.map((d) => {
              const past = d.end <= nowMs
              const today = d.start <= nowMs && nowMs < d.end
              const daySlots = slots.filter((s) => Date.parse(s.startsAt) < d.end && Date.parse(s.endsAt) > d.start)
              const dayDone = done.filter((x) => Date.parse(x.startsAt) < d.end && Date.parse(x.endsAt) > d.start)
              const hours =
                daySlots.filter((s) => s.chosen).reduce((a, s) => a + overlapH(...range(s), Math.max(d.start, nowMs), d.end), 0) +
                dayDone.reduce((a, x) => a + overlapH(...range(x), d.start, d.end), 0)
              const pos = (a: number, b: number) => ({
                left: `${((Math.max(a, d.start) - d.start) / DAY) * 100}%`,
                width: `${((Math.min(b, d.end) - Math.max(a, d.start)) / DAY) * 100}%`,
              })
              return (
                <li key={d.date} className={`wb-day${past ? ' past' : ''}${today ? ' today' : ''}`}>
                  <span className="wb-label">
                    {d.label}
                    {today && <span className="visually-hidden">（今日）</span>}
                  </span>
                  <span className="wb-track">
                    {busyness && (
                      <span className="wb-heat" aria-hidden="true">
                        {Array.from({ length: 24 }, (_, h) => {
                          const l = busyLevelAt(busyness, d.start + h * HOUR)
                          return <span key={h} style={l ? { background: `var(--busy-${l})` } : undefined} />
                        })}
                      </span>
                    )}
                    {past ? (
                      <span className="wb-past" aria-hidden="true" />
                    ) : (
                      today && <span className="wb-past" aria-hidden="true" style={{ width: `${((nowMs - d.start) / DAY) * 100}%` }} />
                    )}
                    {dayDone.map((x) => (
                      <span key={x.startsAt} className="wb-done" style={pos(...range(x))} title={`実績 ${hm(Date.parse(x.startsAt))}〜${hm(Date.parse(x.endsAt))}`} />
                    ))}
                    {daySlots.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`wb-slot${s.chosen ? ' chosen' : ''}`}
                        style={pos(...range(s))}
                        aria-label={`${s.label}${s.chosen ? '（✅ おすすめ）' : '（選ばれなかった候補）'}を編集`}
                        onClick={() => onEdit(s.id)}
                      />
                    ))}
                    {today && <span className="wb-now" aria-hidden="true" style={{ left: `${((nowMs - d.start) / DAY) * 100}%` }} />}
                  </span>
                  <span className="wb-hours num">{hours > 0 ? fmtH(hours) : ''}</span>
                  {past ? (
                    <span className="wb-add" />
                  ) : (
                    <button type="button" className="wb-add icon" aria-label={`${d.label}日に枠を足す`} onClick={() => onAdd(d.date)}>
                      ＋
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
        <p className="wb-legend hint" aria-hidden="true">
          <span className="key chosen" />予定 <span className="key cand" />候補 <span className="key done" />実績
          {busyness && (
            <>
              {' '}
              <span className="key" style={{ background: 'var(--busy-4)' }} />混む <span className="key" style={{ background: 'var(--busy-1)' }} />空き
            </>
          )}
        </p>
      </section>

      <section className="card stack" aria-labelledby="suggest-title">
        <CardTitle
          id="suggest-title"
          tip="まだ予定・実績のない時間から、主なエリアの混み具合と自分の実績で、3時間の売上の見込みが大きい時間を1日1つ、最大3つ出します。帰宅締切を過ぎる時間は出しません。＋で候補枠の入力を開きます（見込みは入った状態）。"
        >
          💡 空いている、稼げそうな時間
        </CardTitle>
        {!busyness ? (
          <p className="hint">設定 → エリアで主なエリアの混み具合を入れると、稼げそうな時間を出します</p>
        ) : suggestions.length === 0 ? (
          <p className="hint">この週の残りに、おすすめできる空き時間はありません</p>
        ) : (
          <ul className="list" aria-label="稼げそうな時間">
            {suggestions.map((w) => {
              const s = Date.parse(w.startsAt)
              const d = new Date(s)
              const text = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]}) ${hm(s)}〜${hm(Date.parse(w.endsAt))}`
              return (
                <li key={w.startsAt} className="line">
                  <span className="grow">
                    <strong>{text}</strong>
                    <span className="levels" role="img" aria-label={`混み具合 ${w.levels.join('・')}`}>
                      {w.levels.map((l, i) => (
                        <span key={i} className="lv" style={{ background: `var(--busy-${l})` }} aria-hidden="true">
                          {l}
                        </span>
                      ))}
                    </span>
                  </span>
                  <span className="num">約{formatYen(w.revenueYen)}</span>
                  <button type="button" className="icon" aria-label={`${text}を候補枠に入れる`} onClick={() => onAddSuggestion(w)}>
                    ＋
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}
