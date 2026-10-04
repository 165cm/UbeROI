// 計画（S05）：週の候補枠を入れ、悲観／標準／楽観で比べ、週の時間内で利益が最大の組み合わせを選ぶ
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  SCENARIOS,
  SCENARIO_FACTORS,
  SCENARIO_LABELS,
  calculateSession,
  estimateRevenue,
  evaluateSlot,
  feeFor,
  periodRange,
  planWeek,
  shiftPeriod,
  summarizePlan,
  weeklyFixedCostYen,
  weeksToRecover,
  type PastSession,
  type Scenario,
  type SlotInput,
  type SlotIssue,
} from '../domain'
import { IntInput, Notice, Problems, TextInput, errorMessages, localToday } from '../components/fields'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { EQUIPMENT_PRESETS } from '../storage/presets'
import { listTariffs, newId, pickDefaultTariff, saveSlot } from '../storage/repo'
import type { SlotRecord, TariffRecord } from '../storage/schema'
import { expandRecurring, sessionToInput } from '../storage/toDomain'

const ISSUE_LABELS: Record<SlotIssue | 'overlap_or_budget', string> = {
  invalid_time: '時間が正しくない',
  past_deadline: '帰宅締切を過ぎる',
  missing_estimate: '見込みが未入力',
  not_profitable: '見込み利益が0円以下',
  overlap_or_budget: 'ほかの枠と重なる／週の時間を超える',
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
  }), [db])
  const [anchor, setAnchor] = useState(localToday())
  const [scenario, setScenario] = useState<Scenario>('standard')
  const [editing, setEditing] = useState<SlotRecord | null>(null)
  const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null)

  const week = periodRange('week', anchor)

  const computed = useMemo(() => {
    if (!data) return null
    const past: PastSession[] = []
    for (const s of data.sessions) {
      if (s.status !== 'completed') continue
      try {
        const r = calculateSession(sessionToInput(s))
        if (r.valid && r.hours) past.push({ departedAt: s.departedAt, hours: r.hours, revenueYen: r.revenueYen })
      } catch {
        // 読めない記録は見込みに使わない
      }
    }
    const inWeek = data.slots.filter((s) => {
      const d = localParts(s.startsAt).date
      return d >= week.from && d <= week.to
    })
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
    const plan = planWeek(inputs, data.settings?.weeklyBudgetMinutes ?? null, scenario, fixed)
    return { past, inWeek, inputs, plan, tariffOf }
  }, [data, week.from, week.to, scenario])

  if (!data || !computed) return <p className="loading">読み込み中…</p>

  const { plan, inWeek, inputs, past } = computed
  const budget = data.settings?.weeklyBudgetMinutes ?? null
  const target = data.settings?.targetHourlyYen ?? null
  const chosen = new Set(plan.chosenIds)
  const skippedReason = new Map(plan.skipped.map((s) => [s.id, s.reason]))

  const newSlot = (): SlotRecord => {
    const date = week.from <= localToday() && localToday() <= week.to ? localToday() : week.from
    const startsAt = new Date(`${date}T17:00`).toISOString()
    const endsAt = new Date(`${date}T21:00`).toISOString()
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

  if (editing) {
    return (
      <SlotForm
        initial={editing}
        past={past}
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
      <p className="hint">働けそうな時間（家を出てから帰るまで）を候補として入れると、週の時間内で見込み利益が一番大きくなる組み合わせを選びます。見込みは予測で、実績ではありません。</p>

      <p className="hint">どの見込みで選ぶか：</p>
      <div className="segmented" role="tablist" aria-label="どの見込みで選ぶか">
        {SCENARIOS.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={scenario === s} onClick={() => setScenario(s)}>
            {SCENARIO_LABELS[s]}
          </button>
        ))}
      </div>

      {notice && <Notice message={notice.message} onUndo={notice.undo} onClose={() => setNotice(null)} />}

      <section className="card stack" aria-labelledby="plan-title">
        <h3 id="plan-title">🗓️ この週のおすすめ（{SCENARIO_LABELS[scenario]}で選択）</h3>
        <dl className="stats">
          <div><dt>選んだ枠</dt><dd>{plan.chosenIds.length}件 / 候補{inWeek.length}件</dd></div>
          <div>
            <dt>拘束時間</dt>
            <dd>{plan.totalHours.toFixed(1)}時間{budget !== null ? ` / 上限${(budget / 60).toFixed(1)}時間` : '（週の上限：未設定）'}</dd>
          </div>
          {plan.fixedCostYen > 0 && (
            <div><dt>毎月の固定費（この週の日数分）</dt><dd>−{formatYen(plan.fixedCostYen)}</dd></div>
          )}
        </dl>
        <div className="table-scroll">
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
        <p className="hint">営業利益は、選んだ枠の見込み利益から毎月の固定費（週の日数で按分）を引いた額です。悲観・楽観は標準の売上の 0.8倍・1.2倍の目安で、統計的な範囲ではありません。レンタル代は料金設定からの見積です。</p>
      </section>

      <button type="button" className="primary" onClick={() => setEditing(newSlot())}>＋ 候補枠を追加</button>

      {inWeek.length === 0 ? (
        <section className="card muted">
          <h3>候補枠がありません</h3>
          <p>「＋ 候補枠を追加」で、この週に働けそうな時間を入れてください。</p>
        </section>
      ) : (
        <ul className="list">
          {inWeek.map((s) => {
            const input = inputs.find((i) => i.id === s.id)!
            const ev = evaluateSlot(input, scenario)
            const reason = skippedReason.get(s.id)
            return (
              <li key={s.id} className="card stack">
                <div className="row-between">
                  <strong>{slotLabel(s)}</strong>
                  <span className="tag">{chosen.has(s.id) ? '✅ おすすめ' : `— ${reason ? ISSUE_LABELS[reason] : ''}`}</span>
                </div>
                <p className="hint">
                  {ev.hours.toFixed(1)}時間{s.areaLabel && `・${s.areaLabel}`}・レンタル {input.rentalYen === null ? '算出不可（入力してください）' : formatYen(input.rentalYen)}
                </p>
                <p>
                  {SCENARIO_LABELS[scenario]}の見込み利益 <strong>{formatYen(ev.profitYen[scenario])}</strong>（{perHour(ev.hourlyYen[scenario])}）
                </p>
                {s.estimateNote && <p className="hint">見込みの出どころ：{s.estimateNote}</p>}
                <div className="row">
                  <button type="button" onClick={() => setEditing(s)}>✏️ 編集</button>
                  <button
                    type="button"
                    className="danger-text"
                    onClick={async () => {
                      await db.slots.delete(s.id)
                      setNotice({ message: '🗑️ 候補枠を削除しました', undo: () => void db.slots.put(s).then(() => setNotice(null)) })
                    }}
                  >
                    削除
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <section className="card stack" aria-labelledby="eq-title">
        <h3 id="eq-title">🎒 装備を買った場合の回収の目安</h3>
        <p className="hint">この週の{SCENARIO_LABELS[scenario]}の見込み利益で、各プランの「これから必要な現金」を割った目安です。装備を良くしても売上が増えるとは仮定していません。</p>
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
                <dt>{EQUIPMENT_PRESETS[tier].name}（必要な現金 {formatYen(cash)}{unpriced ? `・価格未設定${unpriced}品目` : ''}）</dt>
                <dd>
                  {cash === 0 && unpriced > 0
                    ? '価格を入れると計算します'
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
  )
}

function SlotForm({
  initial,
  past,
  tariff,
  onSave,
  onCancel,
}: {
  initial: SlotRecord
  past: PastSession[]
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
    const est = estimateRevenue(times.startsAt, times.endsAt, past)
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
        <h3>⏱️ 候補の時間（家を出てから帰るまで）</h3>
        <label className="field">
          <span>日付</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="row">
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
        <h3>💴 売上の見込み</h3>
        <button type="button" onClick={fillEstimate} disabled={!times}>🔮 見込みを自動で入れる</button>
        <p className="hint">自分の確定記録が10回以上あれば自分の平均、それまでは参考資料の推計（時間帯・月の目安）を使います。あとから手で直せます。</p>
        {SCENARIOS.map((s) => (
          <IntInput key={s} label={`${SCENARIO_LABELS[s]}の売上`} unit="円" value={slot.revenueYen[s]} onChange={(v) => setRevenue(s, v)} />
        ))}
        {slot.estimateNote && <p className="hint">出どころ：{slot.estimateNote}</p>}
      </section>

      <section className="card stack">
        <h3>🧾 費用の見込み</h3>
        <IntInput
          label="レンタル代（空欄なら料金から見積）"
          unit="円"
          value={slot.rentalOverrideYen}
          onChange={(v) => setSlot({ ...slot, rentalOverrideYen: v })}
          hint={tariff ? `見積：${autoRental === null ? '算出不可（入力してください）' : formatYen(autoRental)}（${tariff.name}）` : undefined}
        />
        <IntInput label="その他の経費" unit="円" value={slot.expenseYen} onChange={(v) => setSlot({ ...slot, expenseYen: v ?? 0 })} />
      </section>

      <Problems items={problems} />
      <div className="actions">
        <button type="submit" className="primary">💾 保存</button>
        <button type="button" onClick={onCancel}>やめる</button>
      </div>
    </form>
  )
}
