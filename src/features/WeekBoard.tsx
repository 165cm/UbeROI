// 計画の一番上：この週の稼働量を決めるための材料をひと目で出す。
// ① 稼働の量（実績・これからの予定・週の上限）、② 7日の帯（混み具合の色の上に、予定と実績）、③ 空いている稼げそうな時間
import {
  PLAN_WEATHERS,
  type WeekOption,
  PLAN_WEATHER_ICONS,
  PLAN_WEATHER_LABELS,
  busyLevelAt,
  dayWeather,
  weatherAt,
  type BusynessTable,
  type PlanWeather,
  type WeatherFactors,
} from '../domain'
import type { ForecastState } from './useForecast'
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
  onAdd,
  onEdit,
  options,
  selectedKey,
  onSelect,
  onAddPlan,
  allowed,
  forecast,
  weatherOverrides,
  weatherFactors,
  onCycleWeather,
  needsSetup,
  estimateNote,
}: {
  needsSetup: boolean
  estimateNote: string
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
  onAdd: (date: string) => void
  onEdit: (id: string) => void
  /** 週の作戦の選択肢（§5.12）。先頭がおすすめ */
  options: WeekOption[]
  selectedKey: string | null
  onSelect: (key: string) => void
  /** 選んだ作戦のシフトをまとめて候補枠に入れる */
  onAddPlan: (shifts: { startsAt: string; endsAt: string }[]) => void
  /** 働ける時間（設定）。null は制限なし */
  allowed: readonly (readonly [number, number])[] | null
  forecast: ForecastState
  /** 帯で手で直した天気（日付 → 天気） */
  weatherOverrides: Readonly<Record<string, PlanWeather>>
  weatherFactors: WeatherFactors
  /** 日の天気を手で直す（null は予報に戻す） */
  onCycleWeather: (date: string, next: PlanWeather | null) => void
}) {
  const nowMs = Date.parse(now)
  const weekStart = new Date(`${weekFrom}T${pad(DAY_START_HOUR)}:00`).getTime()
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const start = new Date(`${date}T${pad(DAY_START_HOUR)}:00`).getTime()
    return { date, start, end: start + DAY, label: `${WEEKDAYS[d.getDay()]} ${d.getDate()}` }
  })
  const weekEnd = days[6]!.end
  const plan = options.find((o) => o.key === selectedKey) ?? options[0] ?? null
  /** 作戦で新しく働く時間（すでに選んだ候補枠の日は除く） */
  const planShifts = plan ? plan.days.filter((d) => !d.fixed).flatMap((d) => d.shifts) : []
  /** その日の、働けない時間（帯に斜線で出す） */
  const offSpans = (start: number, end: number): [number, number][] => {
    if (!allowed) return []
    const out: [number, number][] = []
    let t = start
    for (const [a, b] of allowed) {
      if (b <= start || a >= end) continue
      if (a > t) out.push([t, Math.min(a, end)])
      t = Math.max(t, b)
    }
    if (t < end) out.push([t, end])
    return out
  }
  const hourly = 'forecast' in forecast ? forecast.forecast : null
  /** 日の天気：手で直した天気か、予報（働ける時間の中、なければ 8〜24時の時間）の代表 */
  const dayCond = (date: string, start: number): { cond: PlanWeather | null; manual: boolean } => {
    const manual = weatherOverrides[date]
    if (manual) return { cond: manual, manual: true }
    if (!hourly) return { cond: null, manual: false }
    const hours: PlanWeather[] = []
    for (let h = 0; h < 24; h++) {
      const t = start + h * HOUR
      const inAllowed = allowed ? allowed.some(([a, b]) => a <= t && t < b) : h >= 4 && h < 20
      const w = hourly.get(t)
      if (inAllowed && w) hours.push(w)
    }
    return { cond: dayWeather(hours), manual: false }
  }
  const nextWeather = (cur: PlanWeather | null, manual: boolean): PlanWeather | null => {
    // 予報 → 晴れ → くもり → 雨 → 荒天 → 予報に戻す
    if (!manual) return 'clear'
    const i = PLAN_WEATHERS.indexOf(cur!)
    return i === PLAN_WEATHERS.length - 1 ? null : PLAN_WEATHERS[i + 1]!
  }
  const dayLabel = (iso: string) => {
    const d = new Date(Date.parse(iso))
    return `${WEEKDAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`
  }
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
            <dt>登録済み候補から</dt>
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
            登録済み候補の見込み利益 <strong className="num">{profitYen === null ? '算出不可' : formatYen(profitYen)}</strong>
          </span>
        </p>
      </section>

      <section className="card stack" aria-labelledby="week-plan-title">
        <CardTitle
          id="week-plan-title"
          tip="この週の残りの時間で、どの日に・何時から何時まで働くと利益が一番大きいかを、目標ごとに比べます。天気（雨は件数と単価が上がる・荒天は入れない）、混み具合と自分の実績、レンタルの上限（長く1回借りる方が安い）、1日は1回か昼と夜の2回まで（間で返すか借りたままかは安い方）、働ける時間・週の上限・帰宅締切、日跨ぎとピークのクエストの報酬を入れて計算します。目標時給があれば「利益−目標時給×時間」が一番大きいものをおすすめにします。見込みなので実績には入りません。"
        >
          🧭 今週の作戦
        </CardTitle>
        <p className="hint">未登録の提案です。候補に追加するまで、上の集計には入りません。</p>
        <p className="hint">{estimateNote}</p>
        {needsSetup ? <p>週に使える時間を設定すると、無理のない範囲で提案します。</p> : options.length === 0 || options.every((o) => o.hours === 0) ? (
          <p className="hint">この週の残りに働ける時間がないか、働いても得にならない見込みです（働ける時間・週の上限・天気を確かめてください）</p>
        ) : (
          <div className="week-options" role="radiogroup" aria-label="作戦の選択肢">
            {options.map((o) => (
              <button key={o.key} type="button" role="radio" aria-checked={o.key === plan?.key} className="week-option" onClick={() => onSelect(o.key)}>
                <strong>{o.label}</strong>
                <span>
                  {o.workDays}日・{fmtH(o.hours)}・約{o.orders}件
                </span>
                <span>
                  見込み利益 <strong>{formatYen(o.profitYen)}</strong>
                  {o.hourlyYen !== null && <span className="hint">（{formatYen(o.hourlyYen)}/時）</span>}
                </span>
                <span className="hint">
                  🚲{formatYen(o.rentalYen)}
                  {o.bonusYen > 0 && `・クエスト+${formatYen(o.bonusYen)}`}
                  {o.prizeYen > 0 && `・🏆届けば+${formatYen(o.prizeYen)}`}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card stack" aria-labelledby="week-board-title">
        <CardTitle
          id="week-board-title"
          tip="1行が1日（4時〜翌4時）です。帯の色は主なエリアの混み具合（緑＝混む・稼げる、赤＝空き）。濃い四角が ✅ おすすめの予定、点線は選ばれなかった候補、灰色は実績、🎯 はクエストの次の段階に届くために足すとよい時間です。四角を押すと編集、＋でその日に候補枠を足せます。🎯 の時間は、今の計画で届かない次の段階まで足す時間（1時間の件数から逆算）を、その回の期間の空いている時間から、見込みの大きい順に3時間までの枠で埋めたものです。下の＋でまとめて候補枠に入れられます。"
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
                  {(() => {
                    const { cond, manual } = dayCond(d.date, d.start)
                    const text = cond ? `${PLAN_WEATHER_LABELS[cond]}（${manual ? '手で直した' : '予報'}）` : '未入力'
                    return (
                      <button
                        type="button"
                        className={`wb-weather${manual ? ' manual' : ''}`}
                        aria-label={`${d.label}日の天気：${text}。押すと変える`}
                        disabled={past}
                        onClick={() => onCycleWeather(d.date, nextWeather(cond, manual))}
                      >
                        {cond ? PLAN_WEATHER_ICONS[cond] : '·'}
                      </button>
                    )
                  })()}
                  <span className="wb-track">
                    {busyness && (
                      <span className="wb-heat" aria-hidden="true">
                        {Array.from({ length: 24 }, (_, h) => {
                          const l = busyLevelAt(busyness, d.start + h * HOUR)
                          return <span key={h} style={l ? { background: `var(--busy-${l})` } : undefined} />
                        })}
                      </span>
                    )}
                    {Array.from({ length: 24 }, (_, h) => {
                      const t = d.start + h * HOUR
                      const w = weatherAt(t, hourly, weatherOverrides)
                      if (w !== 'rain' && w !== 'storm') return null
                      return <span key={h} className={w === 'storm' ? 'wb-storm' : 'wb-rain'} aria-hidden="true" style={{ left: `${(h / 24) * 100}%`, width: `${100 / 24}%` }} />
                    })}
                    {offSpans(d.start, d.end).map(([a, b]) => (
                      <span key={a} className="wb-off" aria-hidden="true" style={pos(a, b)} />
                    ))}
                    {past ? (
                      <span className="wb-past" aria-hidden="true" />
                    ) : (
                      today && <span className="wb-past" aria-hidden="true" style={{ width: `${((nowMs - d.start) / DAY) * 100}%` }} />
                    )}
                    {dayDone.map((x) => (
                      <span key={x.startsAt} className="wb-done" style={pos(...range(x))} title={`実績 ${hm(Date.parse(x.startsAt))}〜${hm(Date.parse(x.endsAt))}`} />
                    ))}
                    {planShifts
                      .filter((w) => Date.parse(w.startsAt) < d.end && Date.parse(w.endsAt) > d.start)
                      .map((w) => (
                        <span key={w.startsAt} className="wb-quest" style={pos(...range(w))} aria-hidden="true">
                          🧭
                        </span>
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
          <span className="key chosen" />登録済み・おすすめ <span className="key cand" />候補 <span className="key done" />実績{planShifts.length > 0 && (
            <>
              {' '}
              <span className="key quest" />未登録の提案
            </>
          )}
          {allowed && (
            <>
              {' '}
              <span className="key off" />働けない
            </>
          )}
          {' '}
          <span className="key rain" />雨 <span className="key storm" />荒天
          {busyness && (
            <>
              {' '}
              <span className="key" style={{ background: 'var(--busy-4)' }} />混む <span className="key" style={{ background: 'var(--busy-1)' }} />空き
            </>
          )}
        </p>
        <p className="hint weather-note">
          {forecast.status === 'none'
            ? '🌦️ 設定 → エリアで主なエリアに地図の場所を入れると、天気予報を自動で入れます（天気は日ごとの ·／☀️ を押して手でも入れられます）'
            : forecast.status === 'loading'
              ? '🌦️ 天気予報を取得中…'
              : forecast.status === 'error' && !forecast.forecast
                ? '🌦️ 天気予報を取得できませんでした。日ごとの天気を押して手で入れられます'
                : `🌦️ 天気：Open-Meteo（気象庁）${forecast.fetchedAt ? `・${hm(Date.parse(forecast.fetchedAt))}取得` : ''}${forecast.status === 'error' ? '（前に取得した予報）' : ''}`}
          ・雨の日 件数×{weatherFactors.rainOrders}・1件×{weatherFactors.rainPerOrder}（{weatherFactors.source === 'personal' ? '自分の記録' : '目安'}）
        </p>
        {plan && plan.days.some((d) => d.shifts.length > 0) && (
          <div className="stack strategy-plan" role="group" aria-label="作戦の日ごとの時間">
            <p className="line">
              <span className="grow">
                🧭 <strong>{plan.label}（見込み）</strong>：{plan.workDays}日・<strong>{fmtH(plan.hours)}</strong>・約{plan.orders}件・利益 {formatYen(plan.profitYen)}
                {plan.bonusYen > 0 && `（クエスト+${formatYen(plan.bonusYen)}）`}
              </span>
              {planShifts.length > 0 && (
                <button type="button" className="primary" aria-label="作戦の時間を候補枠に入れる" onClick={() => onAddPlan(planShifts)}>
                  この提案を候補に追加
                </button>
              )}
            </p>
            <ul className="list" aria-label="作戦の日ごと">
              {plan.days
                .filter((d) => d.shifts.length > 0)
                .map((d) => (
                  <li key={d.dayStart} className="stack strategy-row">
                    <span className="line">
                      <strong className="strategy-day">{dayLabel(d.dayStart)}</strong>
                      <span className="grow">{d.shifts.map((x) => `${hm(Date.parse(x.startsAt))}〜${hm(Date.parse(x.endsAt))}`).join('・')}</span>
                      <span className="num">{fmtH(d.hours)}</span>
                    </span>
                    <span className="hint">
                      約{d.orders}件・{formatYen(d.revenueYen)}
                      {d.rentalYen > 0 && `・🚲${formatYen(d.rentalYen)}${d.shifts.length > 1 ? (d.returnBetween ? '（間で返す）' : '（借りたまま）') : ''}`}
                      {d.peakBonusYen > 0 && `・ピーク+${formatYen(d.peakBonusYen)}`}
                      {d.fixed && '・選んだ候補枠'}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>

    </>
  )
}
