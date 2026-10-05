// 稼働記録・終了精算（S03）。保存前に計算明細を見せ、帰宅未入力は下書きにする
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { calculateRental, calculateSession, type Platform } from '../domain'
import { CardTitle, DateTimeInput, IntInput, Problems, Select, TextInput, errorMessages } from '../components/fields'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { listTariffs, newId, pickDefaultTariff, saveSession } from '../storage/repo'
import { PLATFORM_LABELS, WEATHER_LABELS, type SessionRecord, type Weather } from '../storage/schema'
import { sessionToInput } from '../storage/toDomain'

const QUEST_PREFIX = 'quest:'
const OTHER_PREFIX = 'other:'

function adjustmentAmount(s: SessionRecord, kind: 'quest' | 'other'): number | null {
  const a = s.adjustments.find((x) => x.kind === kind)
  return a ? a.amountYen : null
}

function withAdjustment(s: SessionRecord, kind: 'quest' | 'other', amount: number | null): SessionRecord {
  const rest = s.adjustments.filter((x) => x.kind !== kind)
  if (amount === null || amount === 0) return { ...s, adjustments: rest }
  // 明細IDは記録ごとに固定し、同じボーナスを二重に計上しない
  const id = `${kind === 'quest' ? QUEST_PREFIX : OTHER_PREFIX}${s.id}`
  return { ...s, adjustments: [...rest, { id, kind, amountYen: amount }] }
}

export function SessionForm({ initial, onDone }: { initial: SessionRecord; onDone: (message: string) => void }) {
  const { db } = useData()
  const [s, setS] = useState<SessionRecord>(initial)
  const [problems, setProblems] = useState<string[]>([])
  // 天気・エリア・メモは、最初から入っている時だけ開いておく（入力中に畳まれないよう、最初に1回だけ決める）
  const [memoOpen] = useState(() => Boolean(initial.weather || initial.areaLabel || initial.note))
  const tariffs = useLiveQuery(() => listTariffs(db), [db]) ?? []
  const settings = useLiveQuery(() => db.settings.get('settings'), [db])
  const defaultTariff = pickDefaultTariff(tariffs, settings)
  const set = (patch: Partial<SessionRecord>) => setS((cur) => ({ ...cur, ...patch }))

  const preview = useMemo(() => {
    try {
      return calculateSession(sessionToInput({ ...s, status: s.returnedAt ? 'completed' : s.status }), { asOf: new Date().toISOString() })
    } catch (e) {
      return { error: errorMessages(e) }
    }
  }, [s])

  const save = async (requested: SessionRecord['status']) => {
    // 稼働中の記録を途中保存する時は、稼働中のままにする
    const status = requested === 'draft' && initial.status === 'active' && !s.returnedAt ? 'active' : requested
    try {
      await saveSession(db, { ...s, status })
      onDone(status === 'completed' ? '✅ 確定して保存しました' : status === 'active' ? '💾 保存しました（稼働中）' : '📝 下書きとして保存しました')
    } catch (e) {
      setProblems(errorMessages(e))
    }
  }

  const onlineMinutes = s.summaryOnlineSeconds === null ? null : Math.round(s.summaryOnlineSeconds / 60)

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault()
        void save('completed')
      }}
    >
      <section className="card stack">
        <h3>⏱️ 時間</h3>
        <div className="row">
          <DateTimeInput label="出発（自宅を出た時刻）" value={s.departedAt} onChange={(v) => v && set({ departedAt: v })} />
          <DateTimeInput label="帰宅" value={s.returnedAt} onChange={(v) => set({ returnedAt: v })} tip="空欄なら下書き（確定の集計に入りません）" />
        </div>
        <IntInput
          label="オンライン時間"
          unit="分"
          value={onlineMinutes}
          onChange={(v) => set({ summaryOnlineSeconds: v === null ? null : v * 60 })}
          tip="配達アプリをオンラインにしていた合計。自宅との往復は含めない"
        />
      </section>

      <section className="card stack">
        <h3>💴 売上</h3>
        <div className="row">
          <IntInput label="基本報酬（配送料の合計）" unit="円" value={s.baseYen} onChange={(v) => set({ baseYen: v })} />
          <IntInput label="チップ" unit="円" value={s.tipsYen} onChange={(v) => set({ tipsYen: v })} />
        </div>
        <div className="row">
          <IntInput label="確定ボーナス" unit="円" value={adjustmentAmount(s, 'quest')} onChange={(v) => setS((cur) => withAdjustment(cur, 'quest', v))} tip="クエスト・ボーナスのうち、確定した額だけ（見込みは入れない）" />
          <IntInput label="その他の調整（±）" unit="円" allowNegative value={adjustmentAmount(s, 'other')} onChange={(v) => setS((cur) => withAdjustment(cur, 'other', v))} tip="キャンセル報酬など。マイナスも可" />
        </div>
        <div className="row">
          <IntInput label="完了件数" unit="件" value={s.completedCount} onChange={(v) => set({ completedCount: v })} />
          <Select label="サービス" value={s.platform} options={(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))} onChange={(v) => set({ platform: v })} />
        </div>
      </section>

      <section className="card stack">
        <CardTitle
          right={
            defaultTariff && (
              <button
                type="button"
                className="icon"
                aria-label={`レンタルを追加（${defaultTariff.name}）`}
                onClick={() => {
                  const t = defaultTariff
                  set({ rentals: [...s.rentals, { id: newId(), tariffName: t.name, tariff: t.tariff, startAt: s.departedAt, endAt: s.returnedAt, billedYen: null }] })
                }}
              >
                ＋
              </button>
            )
          }
        >
          🚲 レンタル
        </CardTitle>
        {s.rentals.length === 0 && <p className="hint">なし（自分の自転車など）</p>}
        {s.rentals.map((r, i) => {
          const est = calculateRental({ tariff: r.tariff, startAt: r.startAt, endAt: r.endAt })
          const update = (patch: Partial<typeof r>) => set({ rentals: s.rentals.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
          return (
            <div key={r.id} className="subcard stack">
              <div className="line">
                <span className="grow hint">{r.tariffName}</span>
                <span>
                  見積 <strong>{est.status === 'unsupported' ? '算出不可' : formatYen(est.estimatedYen)}</strong>
                </span>
                <button type="button" className="icon danger-text" aria-label="このレンタルを外す" onClick={() => set({ rentals: s.rentals.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
              {est.reason && <p className="hint">{est.reason}</p>}
              <div className="row">
                <DateTimeInput label="貸出" value={r.startAt} onChange={(v) => update({ startAt: v })} />
                <DateTimeInput label="返却" value={r.endAt} onChange={(v) => update({ endAt: v })} />
              </div>
              <IntInput label="実請求額" unit="円" value={r.billedYen} onChange={(v) => update({ billedYen: v })} tip="入力すると見積より優先します。0円も有効です" />
            </div>
          )
        })}
      </section>

      <section className="card stack">
        <CardTitle
          right={
            <button type="button" className="icon" aria-label="経費を追加" onClick={() => set({ directExpenses: [...s.directExpenses, { id: newId(), category: 'other', amountYen: 0, memo: '' }] })}>
              ＋
            </button>
          }
        >
          🧾 その他の経費
        </CardTitle>
        {s.directExpenses.length === 0 && <p className="hint">なし</p>}
        {s.directExpenses.map((e, i) => (
          <div key={e.id} className="row">
            <IntInput label="金額" unit="円" value={e.amountYen} onChange={(v) => set({ directExpenses: s.directExpenses.map((x, j) => (j === i ? { ...x, amountYen: v ?? 0 } : x)) })} />
            <TextInput label="内容" value={e.memo} onChange={(v) => set({ directExpenses: s.directExpenses.map((x, j) => (j === i ? { ...x, memo: v } : x)) })} />
            <button type="button" className="icon danger-text" aria-label="この経費を外す" onClick={() => set({ directExpenses: s.directExpenses.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
      </section>

      <details className="card fold" open={memoOpen}>
        <summary>
          <strong>🏷️ 天気・エリア・メモ</strong>
          <span className="hint">{[s.weather && WEATHER_LABELS[s.weather], s.areaLabel, s.note].filter(Boolean).join('・') || '任意'}</span>
        </summary>
        <div className="stack">
          <Select
            label="天気"
            value={(s.weather ?? '') as Weather | ''}
            options={[{ value: '' as const, label: '記録しない' }, ...(Object.keys(WEATHER_LABELS) as Weather[]).map((w) => ({ value: w, label: WEATHER_LABELS[w] }))]}
            onChange={(v) => set({ weather: v === '' ? null : v })}
            tip="天気ごとの時給を分析に使います"
          />
          <div className="row">
            <TextInput label="エリア（任意）" value={s.areaLabel} onChange={(v) => set({ areaLabel: v })} placeholder="例：駅前" />
            <TextInput label="メモ（任意）" value={s.note} onChange={(v) => set({ note: v })} />
          </div>
        </div>
      </details>

      <section className="card stack" aria-live="polite">
        <CardTitle tip={<>税引前。毎月の固定費と装備の配賦は、分析で月ごとに配ります。{!s.returnedAt && '帰宅が未入力なので、レンタルは今の時刻までの見積です。'}</>}>🧮 計算明細</CardTitle>
        {'error' in preview ? (
          <Problems items={preview.error} />
        ) : (
          <>
            <dl className="stats">
              <div><dt>売上</dt><dd>{formatYen(preview.revenueYen)}</dd></div>
              <div><dt>− レンタル</dt><dd>{formatYen(preview.rentalYen)}</dd></div>
              <div><dt>− その他経費</dt><dd>{formatYen(preview.directExpenseYen)}</dd></div>
              <div><dt>＝ 営業純利益</dt><dd className="big">{formatYen(preview.operatingProfitYen)}</dd></div>
              <div><dt>営業純時給（出発〜帰宅）</dt><dd>{preview.hourlyYen === null ? '算出不可' : `${formatYen(preview.hourlyYen)}/時`}</dd></div>
              <div><dt>売上時給（オンライン中）</dt><dd>{preview.onlineRevenueHourlyYen === null ? '算出不可' : `${formatYen(preview.onlineRevenueHourlyYen)}/時`}</dd></div>
            </dl>
            <Problems items={preview.errors} />
          </>
        )}
      </section>

      <Problems items={problems} />
      <div className="actions">
        <button type="submit" className="primary" disabled={!s.returnedAt}>
          ✅ 確定して保存
        </button>
        <button type="button" onClick={() => void save('draft')}>
          📝 下書き保存
        </button>
      </div>
    </form>
  )
}
