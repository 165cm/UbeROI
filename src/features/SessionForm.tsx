// 稼働記録・終了精算（S03）。保存前に計算明細を見せ、帰宅未入力は下書きにする
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { calculateRental, calculateSession, type Platform } from '../domain'
import { DateTimeInput, IntInput, Problems, Select, TextInput, errorMessages } from '../components/fields'
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
        <DateTimeInput label="出発（自宅を出た時刻）" value={s.departedAt} onChange={(v) => v && set({ departedAt: v })} />
        <DateTimeInput label="帰宅" value={s.returnedAt} onChange={(v) => set({ returnedAt: v })} hint="空欄なら下書き（確定集計に入りません）" />
        <IntInput
          label="オンライン時間"
          unit="分"
          value={onlineMinutes}
          onChange={(v) => set({ summaryOnlineSeconds: v === null ? null : v * 60 })}
          hint="配達アプリをオンラインにしていた合計。自宅との往復は含めない"
        />
      </section>

      <section className="card stack">
        <h3>💴 売上</h3>
        <Select label="サービス" value={s.platform} options={(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))} onChange={(v) => set({ platform: v })} />
        <IntInput label="基本報酬（配送料の合計）" unit="円" value={s.baseYen} onChange={(v) => set({ baseYen: v })} />
        <IntInput label="チップ" unit="円" value={s.tipsYen} onChange={(v) => set({ tipsYen: v })} />
        <IntInput label="確定したクエスト・ボーナス" unit="円" value={adjustmentAmount(s, 'quest')} onChange={(v) => setS((cur) => withAdjustment(cur, 'quest', v))} hint="見込みではなく、確定した額だけ" />
        <IntInput label="その他の調整（±）" unit="円" allowNegative value={adjustmentAmount(s, 'other')} onChange={(v) => setS((cur) => withAdjustment(cur, 'other', v))} hint="キャンセル報酬など。マイナスも可" />
        <IntInput label="完了件数" unit="件" value={s.completedCount} onChange={(v) => set({ completedCount: v })} />
      </section>

      <section className="card stack">
        <h3>🚲 レンタル</h3>
        {s.rentals.length === 0 && <p className="hint">レンタルなし（自分の自転車など）</p>}
        {s.rentals.map((r, i) => {
          const est = calculateRental({ tariff: r.tariff, startAt: r.startAt, endAt: r.endAt })
          const update = (patch: Partial<typeof r>) => set({ rentals: s.rentals.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
          return (
            <div key={r.id} className="subcard stack">
              <p className="hint">{r.tariffName}</p>
              <DateTimeInput label="貸出" value={r.startAt} onChange={(v) => update({ startAt: v })} />
              <DateTimeInput label="返却" value={r.endAt} onChange={(v) => update({ endAt: v })} />
              <p>
                見積：<strong>{est.status === 'unsupported' ? '算出不可' : formatYen(est.estimatedYen)}</strong>
                {est.reason && <span className="hint">（{est.reason}）</span>}
              </p>
              <IntInput label="実請求額" unit="円" value={r.billedYen} onChange={(v) => update({ billedYen: v })} hint="入力すると見積より優先。0円も有効" />
              <button type="button" className="danger-text" onClick={() => set({ rentals: s.rentals.filter((_, j) => j !== i) })}>
                このレンタルを外す
              </button>
            </div>
          )
        })}
        {defaultTariff && (
          <button
            type="button"
            onClick={() => {
              const t = defaultTariff
              set({ rentals: [...s.rentals, { id: newId(), tariffName: t.name, tariff: t.tariff, startAt: s.departedAt, endAt: s.returnedAt, billedYen: null }] })
            }}
          >
            ＋ レンタルを追加（{defaultTariff.name}）
          </button>
        )}
      </section>

      <section className="card stack">
        <h3>🧾 その他の経費</h3>
        {s.directExpenses.map((e, i) => (
          <div key={e.id} className="row">
            <IntInput label="金額" unit="円" value={e.amountYen} onChange={(v) => set({ directExpenses: s.directExpenses.map((x, j) => (j === i ? { ...x, amountYen: v ?? 0 } : x)) })} />
            <TextInput label="内容" value={e.memo} onChange={(v) => set({ directExpenses: s.directExpenses.map((x, j) => (j === i ? { ...x, memo: v } : x)) })} />
            <button type="button" className="danger-text" aria-label="この経費を外す" onClick={() => set({ directExpenses: s.directExpenses.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" onClick={() => set({ directExpenses: [...s.directExpenses, { id: newId(), category: 'other', amountYen: 0, memo: '' }] })}>
          ＋ 経費を追加
        </button>
      </section>

      <section className="card stack">
        <h3>🏷️ メモ</h3>
        <Select
          label="天気"
          value={(s.weather ?? '') as Weather | ''}
          options={[{ value: '' as const, label: '記録しない' }, ...(Object.keys(WEATHER_LABELS) as Weather[]).map((w) => ({ value: w, label: WEATHER_LABELS[w] }))]}
          onChange={(v) => set({ weather: v === '' ? null : v })}
          hint="天気ごとの時給を分析に使います"
        />
        <TextInput label="エリア（任意）" value={s.areaLabel} onChange={(v) => set({ areaLabel: v })} placeholder="例：駅前" />
        <TextInput label="メモ（任意）" value={s.note} onChange={(v) => set({ note: v })} />
      </section>

      <section className="card stack" aria-live="polite">
        <h3>🧮 計算明細（税引前）</h3>
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
            <p className="hint">毎月の固定費と装備の配賦は、分析で月ごとに配ります。</p>
            {!s.returnedAt && <p className="hint">帰宅が未入力なので、レンタルは今の時刻までの見積です。</p>}
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
