// 計画（S05）：週の候補枠を入れ、悲観／標準／楽観で比べ、週の時間内で利益が最大の組み合わせを選ぶ
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  SCENARIOS,
  deadlineMs,
  suggestHours,
  suggestWindows,
  SCENARIO_FACTORS,
  SCENARIO_LABELS,
  estimateRevenue,
  evaluateSlot,
  feeFor,
  periodRange,
  planWeek,
  shiftPeriod,
  summarizePlan,
  weeklyFixedCostYen,
  weeksToRecover,
  type BusynessTable,
  type PastSession,
  type Scenario,
  type SlotInput,
  type SlotIssue,
} from '../domain'
import { CardTitle, IntInput, Notice, Problems, TextInput, Tip, errorMessages, localToday } from '../components/fields'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { EQUIPMENT_PRESETS } from '../storage/presets'
import { listTariffs, newId, pickDefaultTariff, primaryArea, saveSlot, saveSlots } from '../storage/repo'
import type { SlotRecord, TariffRecord } from '../storage/schema'
import { expandRecurring, pastSessionsFor } from '../storage/toDomain'
import { QuestWeek, questWeekItems } from './QuestWeek'
import { WeekBoard, type QuestTarget } from './WeekBoard'
import { AreaRoutePlan } from './AreaRoutePlan'

/** 7日の帯に出すクエストの数の上限（毎日のクエストなどで帯が埋まらないように） */
const MAX_QUEST_TARGETS = 3

const ISSUE_LABELS: Record<SlotIssue | 'overlap_or_budget', string> = {
  invalid_time: '時間が正しくない',
  past_deadline: '帰宅締切を過ぎる',
  missing_estimate: '見込みが未入力',
  not_profitable: '見込み利益が0円以下',
  overlap_or_budget: 'ほかの枠と重なる／週の残りの時間を超える',
}

const pad = (n: number) => String(n).padStart(2, '0')
function localParts(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}
function slotLabel(s: { startsAt: string; endsAt: string }): string {
  const a = new Date(s.startsAt)
  const b = new Date(s.endsAt)
  const day = a.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
  const t = (d: Date) => d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  return `${day} ${t(a)}〜${t(b)}`
}
const perHour = (v: number | null) => (v === null ? '算出不可' : `${formatYen(v)}/時`)

function rentalFor(slot: SlotRecord, tariff: TariffRecord | undefined): number | null {
  if (slot.rentalOverrideYen !== null) return slot.rentalOverrideYen
  if (!tariff) return 0
  const seconds = Math.max(0, (Date.parse(slot.endsAt) - Date.parse(slot.startsAt)) / 1000)
  return feeFor(tariff.tariff, seconds)
}

export function Plan() {
  const { db } = useData()
  const data = useLiveQuery(async () => ({
    slots: await db.slots.orderBy('startsAt').toArray(),
    recurringExpenses: await db.recurringExpenses.toArray(),
    sessions: await db.sessions.toArray(),
    plans: await db.plans.toArray(),
    tariffs: await listTariffs(db),
    settings: await db.settings.get('settings'),
    areas: await db.areas.toArray(),
    quests: await db.quests.toArray(),
  }), [db])
  const [anchor, setAnchor] = useState(localToday())
  const [scenario, setScenario] = useState<Scenario>('standard')
  const [editing, setEditing] = useState<SlotRecord | null>(null)
  const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null)

  const week = periodRange('week', anchor)

  const computed = useMemo(() => {
    if (!data) return null
    const past = pastSessionsFor(data.sessions)
    // 週は、帯と同じく月曜4時〜翌週の月曜4時（深夜0〜4時は前の日の続き）
    const weekStartIso = new Date(`${week.from}T04:00`).toISOString()
    const weekEndIso = new Date(Date.parse(`${week.to}T04:00`) + 86_400_000).toISOString()
    const inWeek = data.slots.filter((s) => s.startsAt >= weekStartIso && s.startsAt < weekEndIso)
    // この週の確定した稼働（出発〜帰宅）
    const done = data.sessions
      .filter((x) => x.status === 'completed' && x.returnedAt && x.departedAt < weekEndIso && x.returnedAt > weekStartIso)
      .map((x) => ({ startsAt: x.departedAt, endsAt: x.returnedAt! }))
    const doneMinutes = done.reduce(
      (a, x) => a + Math.max(0, Math.min(Date.parse(x.endsAt), Date.parse(weekEndIso)) - Math.max(Date.parse(x.startsAt), Date.parse(weekStartIso))) / 60_000,
      0,
    )
    const nowIso = new Date().toISOString()
    const tariffOf = (s: SlotRecord) => data.tariffs.find((t) => t.id === s.tariffId) ?? pickDefaultTariff(data.tariffs, data.settings)
    const inputs: SlotInput[] = inWeek.map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      revenueYen: s.revenueYen,
      rentalYen: rentalFor(s, tariffOf(s)),
      expenseYen: s.expenseYen,
      homeDeadline: data.settings?.homeDeadline ?? null,
    }))
    const fixed = weeklyFixedCostYen(expandRecurring(data.recurringExpenses, week.from.slice(0, 7), week.to.slice(0, 7)), week.from, week.to)
    // おすすめは、まだ終わっていない枠から、週の上限からこの週の実績を引いた時間の中で選ぶ
    const budgetMinutes = data.settings?.weeklyBudgetMinutes ?? null
    const plan = planWeek(
      inputs.filter((i) => i.endsAt > nowIso),
      budgetMinutes === null ? null : Math.max(0, Math.round(budgetMinutes - doneMinutes)),
      scenario,
      fixed,
    )
    return { past, inWeek, inputs, plan, tariffOf, done, weekStartIso, weekEndIso, nowIso }
  }, [data, week.from, week.to, scenario])

  if (!data || !computed) return <p className="loading">読み込み中…</p>

  const { plan, inWeek, inputs, past } = computed
  const budget = data.settings?.weeklyBudgetMinutes ?? null
  const target = data.settings?.targetHourlyYen ?? null
  const chosen = new Set(plan.chosenIds)
  // 選んだ枠の、1時間あたりの費用（レンタル代・経費）。クエストの追加の時間の見込みに使う
  const chosenInputs = inputs.filter((i) => chosen.has(i.id))
  const chosenHours = chosenInputs.reduce((a, i) => a + (Date.parse(i.endsAt) - Date.parse(i.startsAt)) / 3_600_000, 0)
  const costPerHour = chosenHours > 0 ? Math.round(chosenInputs.reduce((a, i) => a + (i.rentalYen ?? 0) + i.expenseYen, 0) / chosenHours) : 0
  const skippedReason = new Map(plan.skipped.map((s) => [s.id, s.reason]))

  const newSlot = (day?: string, times?: { startsAt: string; endsAt: string }): SlotRecord => {
    const date = day ?? (week.from <= localToday() && localToday() <= week.to ? localToday() : week.from)
    const startsAt = times?.startsAt ?? new Date(`${date}T17:00`).toISOString()
    const endsAt = times?.endsAt ?? new Date(`${date}T21:00`).toISOString()
    return {
      id: newId(),
      startsAt,
      endsAt,
      areaLabel: '',
      revenueYen: { pessimistic: null, standard: null, optimistic: null },
      estimateNote: '',
      rentalOverrideYen: null,
      expenseYen: 0,
      tariffId: null,
      createdAt: '',
      updatedAt: '',
      revision: 0,
    }
  }

  const { done, weekStartIso, weekEndIso, nowIso } = computed
  const busyness = primaryArea(data.areas, data.settings)?.levels ?? null
  const homeDeadline = data.settings?.homeDeadline ?? null
  const estimate = (st: string, e: string) => estimateRevenue(st, e, past, busyness).revenueYen
  const deadline = homeDeadline ? (st: string) => deadlineMs(st, homeDeadline) : null
  // クエスト：計画で届かない次の段階まで、あと何時間か（逆算）と、その時間をどこで働くか
  const questInput = {
    now: nowIso,
    weekStart: weekStartIso,
    weekEnd: weekEndIso,
    quests: data.quests,
    sessions: data.sessions,
    past,
    chosenSlots: inWeek.filter((s) => chosen.has(s.id)),
    costPerHourYen: costPerHour,
    targetHourlyYen: target,
  }
  const questTargets: QuestTarget[] = []
  const taken: { startsAt: string; endsAt: string }[] = [...inWeek, ...done]
  // 先に終わる回から（§5.8）
  const questItems = [...questWeekItems(questInput).items].sort((a, b) => a.occ.endsAt.localeCompare(b.occ.endsAt))
  for (const { q, occ, plan: qp } of questItems) {
    const goal = qp.tiers.find((t) => !t.reachedByPlan && t.possible)
    if (!goal || goal.extraHours <= 0 || questTargets.length >= MAX_QUEST_TARGETS) continue
    const found = busyness
      ? suggestHours({
          now: nowIso,
          from: occ.startsAt > weekStartIso ? occ.startsAt : weekStartIso,
          to: occ.endsAt < weekEndIso ? occ.endsAt : weekEndIso,
          busyness,
          busy: taken,
          estimate,
          deadline,
          hoursNeeded: goal.extraHours,
        })
      : null
    if (found) taken.push(...found.windows)
    questTargets.push({
      key: `${q.id}-${occ.index}`,
      label: q.label,
      tier: goal.tier,
      gainYen: goal.gainYen,
      extraHours: goal.extraHours,
      hourlyYen: goal.extraHourlyYen,
      belowTarget: target !== null && goal.extraHourlyYen !== null && goal.extraHourlyYen < target,
      windows: found?.windows ?? [],
      shortHours: found?.shortHours ?? 0,
    })
  }
  const suggestions = busyness
    ? suggestWindows({ now: nowIso, from: weekStartIso, to: weekEndIso, busyness, busy: taken, estimate, deadline })
    : []
  /** おすすめの時間から、見込みを入れた候補枠の入力を開く */
  const fromSuggestion = (w: { startsAt: string; endsAt: string }): SlotRecord => {
    const est = estimateRevenue(w.startsAt, w.endsAt, past, busyness)
    return {
      ...newSlot(undefined, w),
      revenueYen: {
        pessimistic: Math.round(est.revenueYen * SCENARIO_FACTORS.pessimistic),
        standard: est.revenueYen,
        optimistic: Math.round(est.revenueYen * SCENARIO_FACTORS.optimistic),
      },
      estimateNote: est.note,
    }
  }

  if (editing) {
    return (
      <SlotForm
        initial={editing}
        past={past}
        busyness={busyness}
        tariff={computed.tariffOf(editing)}
        onCancel={() => setEditing(null)}
        onSave={async (slot) => {
          await saveSlot(db, slot)
          setEditing(null)
          setNotice({ message: '💾 候補枠を保存しました' })
        }}
      />
    )
  }

  return (
    <div className="stack">
      <div className="period-nav">
        <button type="button" aria-label="前の週" onClick={() => setAnchor(shiftPeriod('week', anchor, -1))}>‹</button>
        <strong>{Number(week.from.slice(5, 7))}/{Number(week.from.slice(8))}（月）〜{Number(week.to.slice(5, 7))}/{Number(week.to.slice(8))}（日）</strong>
        <button type="button" aria-label="次の週" onClick={() => setAnchor(shiftPeriod('week', anchor, 1))}>›</button>
      </div>
      {notice && <Notice message={notice.message} onUndo={notice.undo} onClose={() => setNotice(null)} />}

      <WeekBoard
        now={nowIso}
        weekFrom={week.from}
        slots={inWeek.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, chosen: chosen.has(s.id), label: slotLabel(s) }))}
        done={done}
        budgetHours={budget === null ? null : budget / 60}
        profitYen={plan.profitYen[scenario]}
        busyness={busyness}
        suggestions={suggestions}
        onAdd={(date) => setEditing(newSlot(date))}
        onEdit={(id) => setEditing(inWeek.find((s) => s.id === id) ?? null)}
        onAddSuggestion={(w) => setEditing(fromSuggestion(w))}
        questTargets={questTargets}
        onAddQuestWindows={async (windows) => {
          const slots = windows.map(fromSuggestion)
          try {
            await saveSlots(db, slots)
          } catch (e) {
            setNotice({ message: `⚠️ 候補枠を保存できませんでした（1つも入れていません）：${errorMessages(e).join('・')}` })
            return
          }
          setNotice({
            message: `🎯 ${slots.length}つの候補枠を入れました`,
            undo: () => void db.slots.bulkDelete(slots.map((x) => x.id)).then(() => setNotice(null)),
          })
        }}
      />

      <QuestWeek {...questInput} onAddSlot={() => setEditing(newSlot())} />

      <details className="more">
        <summary>
          📋 くわしく見る<span className="hint">比べ方・一覧・エリア・装備</span>
        </summary>
        <div className="stack">
      <div className="line">
        <div className="segmented grow" role="tablist" aria-label="どの見込みで選ぶか">
          {SCENARIOS.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={scenario === s} onClick={() => setScenario(s)}>
              {SCENARIO_LABELS[s]}
            </button>
          ))}
        </div>
        <Tip label="計画">
          働けそうな時間（家を出てから帰るまで）を候補として入れると、週の時間内で見込み利益が一番大きくなる組み合わせを選びます。上のボタンは、どの見込みで選ぶかです。悲観・楽観は標準の売上の0.8倍・1.2倍の目安で、統計的な範囲ではありません。見込みは予測で、実績ではありません。
        </Tip>
      </div>

      <section className="card stack" aria-labelledby="plan-title">
        <CardTitle
          id="plan-title"
          tip="営業利益は、選んだ枠の見込み利益から毎月の固定費（週の日数で按分）を引いた額です。レンタル代は料金設定からの見積です。"
        >
          🗓️ この週のおすすめ（{SCENARIO_LABELS[scenario]}）
        </CardTitle>
        <dl className="stats">
          <div><dt>選んだ枠</dt><dd>{plan.chosenIds.length} / 候補{inWeek.length}件</dd></div>
          <div>
            <dt>拘束時間</dt>
            <dd>{plan.totalHours.toFixed(1)}h{budget !== null ? ` / 上限${(budget / 60).toFixed(1)}h` : '（上限 未設定）'}</dd>
          </div>
          {plan.fixedCostYen > 0 && (
            <div><dt>固定費（週の日数分）</dt><dd>−{formatYen(plan.fixedCostYen)}</dd></div>
          )}
        </dl>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="見込みごとの営業利益と時給">
          <table className="breakdown">
            <thead>
              <tr><th scope="col">見込み</th><th scope="col">営業利益</th><th scope="col">時給</th></tr>
            </thead>
            <tbody>
              {SCENARIOS.map((s) => (
                <tr key={s}>
                  <th scope="row">{SCENARIO_LABELS[s]}{s === scenario ? '（選択）' : ''}</th>
                  <td>{formatYen(plan.profitYen[s])}</td>
                  <td>{perHour(plan.hourlyYen[s])}{target !== null && plan.hourlyYen[s] !== null && plan.hourlyYen[s]! < target ? ' ⚠️目標未満' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <CardTitle>⏱️ 候補枠の一覧</CardTitle>
        {inWeek.length === 0 ? (
          <p className="hint">上の「📅 いつ働くか」の＋で、働けそうな時間を入れてください</p>
        ) : (
          <ul className="list">
            {inWeek.map((s) => {
              const input = inputs.find((i) => i.id === s.id)!
              const ev = evaluateSlot(input, scenario)
              const reason = skippedReason.get(s.id)
              return (
                <li key={s.id} className="line slot-item">
                  <span className="grow">
                    <span className="line">
                      <strong className="grow">{slotLabel(s)}</strong>
                      <span className="num">{formatYen(ev.profitYen[scenario])}</span>
                    </span>
                    <span className="line hint">
                      <span className="grow">
                        {chosen.has(s.id) ? '✅ おすすめ' : s.endsAt <= nowIso ? '— 終わった枠' : `— ${reason ? ISSUE_LABELS[reason] : ''}`}・{ev.hours.toFixed(1)}h{s.areaLabel && `・${s.areaLabel}`}・🚲{input.rentalYen === null ? '算出不可' : formatYen(input.rentalYen)}
                      </span>
                      <span>{perHour(ev.hourlyYen[scenario])}</span>
                    </span>
                  </span>
                  <button type="button" className="icon" aria-label={`${slotLabel(s)}を編集`} onClick={() => setEditing(s)}>✏️</button>
                  <button
                    type="button"
                    className="icon danger-text"
                    aria-label={`${slotLabel(s)}を削除`}
                    onClick={async () => {
                      await db.slots.delete(s.id)
                      setNotice({ message: '🗑️ 候補枠を削除しました', undo: () => void db.slots.put(s).then(() => setNotice(null)) })
                    }}
                  >
                    🗑️
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <AreaRoutePlan
        now={new Date().toISOString()}
        slots={inWeek}
        chosenIds={chosen}
        areas={data.areas}
        primaryId={primaryArea(data.areas, data.settings)?.id ?? null}
        past={past}
      />

      <section className="card stack" aria-labelledby="eq-title">
        <CardTitle id="eq-title" tip={`この週の${SCENARIO_LABELS[scenario]}の見込み利益で、各プランの「これから必要な現金」を割った目安です。装備を良くしても売上が増えるとは仮定していません。`}>
          🎒 装備を買った場合の回収の目安
        </CardTitle>
        <dl className="stats">
          {(['beginner', 'intermediate', 'advanced'] as const).map((tier) => {
            const p = data.plans.find((x) => x.tier === tier)
            if (!p) return null
            let cash = 0
            let unpriced = 0
            try {
              const sum = summarizePlan(p.items)
              cash = sum.cashNeededYen
              unpriced = sum.unpricedCount
            } catch {
              // 不正な品目があるプランは表示だけ省く
            }
            const weeks = weeksToRecover(cash, plan.profitYen[scenario])
            return (
              <div key={tier}>
                <dt>{EQUIPMENT_PRESETS[tier].name}（{formatYen(cash)}{unpriced ? `・未設定${unpriced}` : ''}）</dt>
                <dd>
                  {cash === 0 && unpriced > 0
                    ? '価格未設定'
                    : weeks === null
                      ? '回収見込みなし'
                      : weeks === 0
                        ? '追加の出費なし'
                        : `約${weeks.toFixed(1)}週`}
                </dd>
              </div>
            )
          })}
        </dl>
      </section>
        </div>
      </details>
    </div>
  )
}

function SlotForm({
  initial,
  past,
  busyness,
  tariff,
  onSave,
  onCancel,
}: {
  initial: SlotRecord
  past: PastSession[]
  busyness: BusynessTable | null
  tariff: TariffRecord | undefined
  onSave: (slot: SlotRecord) => Promise<void>
  onCancel: () => void
}) {
  const start0 = localParts(initial.startsAt)
  const end0 = localParts(initial.endsAt)
  const [date, setDate] = useState(start0.date)
  const [startTime, setStartTime] = useState(start0.time)
  const [endTime, setEndTime] = useState(end0.time)
  const [slot, setSlot] = useState(initial)
  const [problems, setProblems] = useState<string[]>([])

  // 帰宅の時刻が出発より前なら、翌日の帰宅とみなす
  const times = useMemo(() => {
    const s = new Date(`${date}T${startTime}`)
    const e = new Date(`${date}T${endTime}`)
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null
    if (e <= s) e.setDate(e.getDate() + 1)
    return { startsAt: s.toISOString(), endsAt: e.toISOString() }
  }, [date, startTime, endTime])

  const fillEstimate = () => {
    if (!times) return
    const est = estimateRevenue(times.startsAt, times.endsAt, past, busyness)
    setSlot({
      ...slot,
      revenueYen: {
        pessimistic: Math.round(est.revenueYen * SCENARIO_FACTORS.pessimistic),
        standard: est.revenueYen,
        optimistic: Math.round(est.revenueYen * SCENARIO_FACTORS.optimistic),
      },
      estimateNote: est.note,
    })
  }

  const setRevenue = (s: Scenario, v: number | null) =>
    setSlot({ ...slot, revenueYen: { ...slot.revenueYen, [s]: v }, estimateNote: slot.estimateNote.startsWith('手入力') ? slot.estimateNote : `手入力（元：${slot.estimateNote || 'なし'}）` })

  const autoRental = times && tariff ? feeFor(tariff.tariff, (Date.parse(times.endsAt) - Date.parse(times.startsAt)) / 1000) : null

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!times) {
          setProblems(['日付と時刻を入れてください'])
          return
        }
        try {
          await onSave({ ...slot, ...times })
        } catch (err) {
          setProblems(errorMessages(err))
        }
      }}
    >
      <button type="button" className="link back" onClick={onCancel}>← 計画へ戻る</button>
      <section className="card stack">
        <CardTitle tip="家を出てから帰るまでの時間です。帰宅が出発より前の時刻なら、翌日の帰宅とみなします。">⏱️ 候補の時間</CardTitle>
        <div className="row">
          <label className="field">
            <span>日付</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>出発</span>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label className="field">
            <span>帰宅</span>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
        <TextInput label="エリア（任意）" value={slot.areaLabel} onChange={(v) => setSlot({ ...slot, areaLabel: v })} />
      </section>

      <section className="card stack">
        <CardTitle tip="自動の見込みは、自分の確定記録が10回以上あれば自分の平均、それまでは推計を使います。推計は、主なエリアの混み具合（設定 → エリア）があればそれを、なければ参考資料の時間帯・月の目安を使います。自分の平均も混み具合の比で補正します。あとから手で直せます。">💴 売上の見込み</CardTitle>
        <button type="button" onClick={fillEstimate} disabled={!times}>🔮 見込みを自動で入れる</button>
        <div className="row">
          {SCENARIOS.map((s) => (
            <IntInput key={s} label={`${SCENARIO_LABELS[s]}の売上`} unit="円" value={slot.revenueYen[s]} onChange={(v) => setRevenue(s, v)} />
          ))}
        </div>
        {slot.estimateNote && <p className="hint">出どころ：{slot.estimateNote}</p>}
      </section>

      <section className="card stack">
        <h3>🧾 費用の見込み</h3>
        <div className="row">
        <IntInput
          label="レンタル代"
          tip="空欄なら料金設定から見積もります"
          unit="円"
          value={slot.rentalOverrideYen}
          onChange={(v) => setSlot({ ...slot, rentalOverrideYen: v })}
          hint={tariff ? `見積：${autoRental === null ? '算出不可（入力してください）' : formatYen(autoRental)}（${tariff.name}）` : undefined}
        />
        <IntInput label="その他の経費" unit="円" value={slot.expenseYen} onChange={(v) => setSlot({ ...slot, expenseYen: v ?? 0 })} />
        </div>
      </section>

      <Problems items={problems} />
      <div className="actions">
        <button type="submit" className="primary">💾 保存</button>
        <button type="button" onClick={onCancel}>やめる</button>
      </div>
    </form>
  )
}
