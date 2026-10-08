import { Money } from '../components/Money'
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
import { serviceRevenues, serviceRevenueYen } from '../storage/services'

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
  // 天気・エリア・メモは、最初から入っている時だけ開いておく。開閉は押した時だけ変え、入力中に畳まれないようにする
  const [memoOpen, setMemoOpen] = useState(() => Boolean(initial.areaLabel || initial.note || initial.completedCount !== null || initial.weather !== null || adjustmentAmount(initial, 'other') !== null || initial.summaryOnlineSeconds !== null))
  const tariffs = useLiveQuery(() => listTariffs(db), [db]) ?? []
  const settings = useLiveQuery(() => db.settings.get('settings'), [db])
  const defaultTariff = pickDefaultTariff(tariffs, settings)
  const set = (patch: Partial<SessionRecord>) => {
    setProblems([])
    setS((cur) => ({ ...cur, ...patch }))
  }

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

  const clock = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  const hours = s.returnedAt ? (Date.parse(s.returnedAt) - Date.parse(s.departedAt)) / 3_600_000 : null

  return (
    <form
      className="stack settlement-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save('completed')
      }}
    >
      <details className="time-band" open={!initial.returnedAt}>
        <summary>
          <span className="grow">
            出発 <strong className="num">{clock(s.departedAt)}</strong> → 帰宅 <strong className="num">{s.returnedAt ? clock(s.returnedAt) : '未入力'}</strong>
          </span>
          {hours !== null && hours >= 0 && <strong className="num">{Math.round(hours * 10) / 10}時間</strong>}
        </summary>
        <div className="stack">
          <div className="row">
            <DateTimeInput label="出発（自宅を出た時刻）" value={s.departedAt} onChange={(v) => v && set({ departedAt: v })} />
            <DateTimeInput label="帰宅" value={s.returnedAt} onChange={(v) => set({ returnedAt: v })} tip="空欄なら下書き（確定の集計に入りません）" />
          </div>
          {s.rentals.map((r, i) => <div className="subcard stack" key={r.id}>
            <p className="hint">{r.tariffName}</p>
            <DateTimeInput label="貸出" value={r.startAt} onChange={(v) => set({ rentals: s.rentals.map((x, j) => j === i ? { ...x, startAt: v } : x) })} />
            <DateTimeInput label="返却" value={r.endAt} onChange={(v) => set({ rentals: s.rentals.map((x, j) => j === i ? { ...x, endAt: v } : x) })} />
            <button type="button" className="danger-text" onClick={() => set({ rentals: s.rentals.filter((_, j) => j !== i) })}>このレンタルを外す</button>
          </div>)}
        </div>
      </details>

      <section className="settle-section stack" aria-labelledby="settle-revenue">
        <h3 id="settle-revenue">売上</h3>
        <fieldset className="service-revenue stack">
        <legend>{PLATFORM_LABELS[s.platform]}</legend>
        <Select label="サービス" value={s.platform} options={(Object.keys(PLATFORM_LABELS) as Platform[]).filter(p => p === s.platform || !(s.additionalServices ?? []).some(r => r.platform === p)).map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))} onChange={(v) => set({ platform: v })} />
        <div className="money-field wide">
          <IntInput label="基本報酬" unit="円" value={s.baseYen} onChange={(v) => set({ baseYen: v })} tip="配送料の合計（配達アプリの今日の売上の明細）" />
        </div>
        <div className="money-grid">
          <div className="money-field"><IntInput label="チップ" unit="円" value={s.tipsYen} onChange={(v) => set({ tipsYen: v })} /></div>
          <div className="money-field"><IntInput label="確定ボーナス" unit="円" value={adjustmentAmount(s, 'quest')} onChange={(v) => setS((cur) => withAdjustment(cur, 'quest', v))} tip="クエスト・ボーナスのうち、確定した額だけ（見込みは入れない）" /></div>
        </div>
        {(s.additionalServices?.length ?? 0) > 0 && <>
          <IntInput label="完了件数" unit="件" value={s.completedCount} onChange={v => set({ completedCount: v })} />
          <IntInput label="その他の調整（±）" unit="円" allowNegative value={adjustmentAmount(s, 'other')} onChange={v => setS(cur => withAdjustment(cur, 'other', v))} />
        </>}
        </fieldset>
        {(s.additionalServices ?? []).map((r, i) => {
          const update = (patch: Partial<typeof r>) => set({ additionalServices: s.additionalServices!.map((x, j) => j === i ? { ...x, ...patch } : x) })
          return <fieldset className="service-revenue stack" key={i}>
            <legend>{PLATFORM_LABELS[r.platform]}</legend>
            <Select label="サービス" value={r.platform} options={(Object.keys(PLATFORM_LABELS) as Platform[]).filter(p => p === r.platform || !serviceRevenues(s).some(x => x.platform === p)).map(p => ({ value: p, label: PLATFORM_LABELS[p] }))} onChange={v => update({ platform: v })} />
            <div className="money-field wide"><IntInput label="基本報酬" unit="円" value={r.baseYen} onChange={v => update({ baseYen: v })} /></div>
            <div className="money-grid">
              <div className="money-field"><IntInput label="チップ" unit="円" value={r.tipsYen} onChange={v => update({ tipsYen: v })} /></div>
              <div className="money-field"><IntInput label="確定ボーナス" unit="円" value={r.bonusYen} onChange={v => update({ bonusYen: v })} /></div>
            </div>
            <IntInput label="完了件数" unit="件" value={r.completedCount} onChange={v => update({ completedCount: v })} />
            <IntInput label="その他の調整（±）" unit="円" allowNegative value={r.adjustmentYen} onChange={v => update({ adjustmentYen: v })} />
            <button type="button" className="danger-text" onClick={() => {
              if (Object.entries(r).some(([key, value]) => key !== 'platform' && value !== null) && !window.confirm(`${PLATFORM_LABELS[r.platform]}の入力を外しますか？`)) return
              set({ additionalServices: s.additionalServices!.filter((_, j) => j !== i) })
            }}>このサービスを外す</button>
          </fieldset>
        })}
        {serviceRevenues(s).length < 4 && <button type="button" className="outline" onClick={() => {
          const platform = (['rocketnow', 'uber', 'demaecan', 'other'] as Platform[]).find(p => !serviceRevenues(s).some(r => r.platform === p))!
          set({ additionalServices: [...(s.additionalServices ?? []), { platform, baseYen: null, tipsYen: null, bonusYen: null, adjustmentYen: null, completedCount: null }] })
        }}>＋ サービスを追加</button>}
        {(s.additionalServices?.length ?? 0) > 0 && <div className="subcard stack" aria-label="サービス別売上">
          <p className="hint">経費と出発〜帰宅の時間は、稼働全体で1回だけ計上します。</p>
          {serviceRevenues(s).map(r => {
            let total: number | null = null
            try { if (r.baseYen !== null) total = serviceRevenueYen(r) } catch { /* 入力エラーは利益欄に表示 */ }
            return <div className="line" key={r.platform}><span className="grow">{PLATFORM_LABELS[r.platform]}</span><strong>{total === null ? '未入力・要確認' : formatYen(total)}</strong></div>
          })}
        </div>}

      </section>

      <section className="settle-section stack" aria-labelledby="settle-cost">
        <CardTitle
          id="settle-cost"
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
          経費
        </CardTitle>
        {s.rentals.map((r, i) => {
          const est = calculateRental({ tariff: r.tariff, startAt: r.startAt, endAt: r.endAt })
          const update = (patch: Partial<typeof r>) => set({ rentals: s.rentals.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
          return (
            <div key={r.id} className="money-field wide stack">
              <IntInput
                label={s.rentals.length > 1 ? `レンタル実請求（${i + 1}）` : 'レンタル実請求'}
                unit="円"
                value={r.billedYen}
                onChange={(v) => update({ billedYen: v })}
                placeholder={est.status === 'unsupported' ? '算出不可' : `見積 ${formatYen(est.estimatedYen)}`}
                tip="シェアサイクルのアプリに出た請求額。空欄なら見積を使います。0円も有効です"
              />
              {est.reason && <p className="hint">{est.reason}</p>}
            </div>
          )
        })}
        <div className="line">
          <strong className="grow">その他</strong>
          <button type="button" className="icon" aria-label="経費を追加" onClick={() => set({ directExpenses: [...s.directExpenses, { id: newId(), category: 'other', amountYen: 0, memo: '' }] })}>
            ＋
          </button>
        </div>
        {s.directExpenses.length === 0 && <p className="hint">なし（＋で追加）</p>}
        {s.directExpenses.map((e, i) => (
          <div key={e.id} className="expense-row money-field">
            <IntInput label="金額" unit="円" value={e.amountYen} onChange={(v) => set({ directExpenses: s.directExpenses.map((x, j) => (j === i ? { ...x, amountYen: v ?? 0 } : x)) })} />
            <details className="expense-note"><summary>用途</summary><TextInput label="内容" value={e.memo} onChange={(v) => set({ directExpenses: s.directExpenses.map((x, j) => (j === i ? { ...x, memo: v } : x)) })} /></details>
            <button type="button" className="icon danger-text" aria-label="この経費を外す" onClick={() => set({ directExpenses: s.directExpenses.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
      </section>

      <details className="card fold extras" open={memoOpen} onToggle={(e) => setMemoOpen(e.currentTarget.open)}>
        <summary>
          <strong>📝 件数・天気・メモを追加</strong>
          <span className="hint">{[s.completedCount !== null && `${s.completedCount}件`, s.weather && WEATHER_LABELS[s.weather], s.areaLabel, s.note].filter(Boolean).join('・') || '任意'}</span>
        </summary>
        <div className="stack">
          <div className="row">
            {!s.additionalServices?.length && <IntInput label="完了件数" unit="件" value={s.completedCount} onChange={(v) => set({ completedCount: v })} />}
          </div>
          <div role="group" aria-labelledby="session-weather-title" className="stack">
            <CardTitle id="session-weather-title" tip="天気ごとの時給・件数を分析と計画（雨の日の倍率）に使います。走っていた時間の多くの天気を1つ選んでください">
              🌦️ 天気
            </CardTitle>
            <div className="buttons weather-chips" role="group" aria-label="天気">
              {(Object.keys(WEATHER_LABELS) as Weather[]).map((w) => (
                <button key={w} type="button" aria-pressed={s.weather === w} onClick={() => set({ weather: s.weather === w ? null : w })}>
                  {WEATHER_LABELS[w]}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <TextInput label="エリア（任意）" value={s.areaLabel} onChange={(v) => set({ areaLabel: v })} placeholder="例：駅前" />
            <TextInput label="メモ（任意）" value={s.note} onChange={(v) => set({ note: v })} />
          </div>
          <div className="row">
            {!s.additionalServices?.length && <IntInput label="その他の調整（±）" unit="円" allowNegative value={adjustmentAmount(s, 'other')} onChange={(v) => setS((cur) => withAdjustment(cur, 'other', v))} tip="キャンセル報酬など。マイナスも可" />}
            <IntInput
              label="オンライン時間"
              unit="分"
              value={onlineMinutes}
              onChange={(v) => set({ summaryOnlineSeconds: v === null ? null : v * 60 })}
              tip="いずれかのサービスでオンラインだった時間。同時にオンラインにしていた時間は1回だけ数え、自宅との往復は含めない"
            />
          </div>
        </div>
      </details>

      <section className="settlement-result stack" aria-live="polite" aria-labelledby="settle-result-title">
        <h3 id="settle-result-title" className="visually-hidden">今日の利益</h3>
        {'error' in preview ? (
          <Problems items={preview.error} />
        ) : (
          <>
            <div className="result-row">
              <div>
                <span className="label">今日の利益</span>
                <strong className="result-big num"><Money value={preview.operatingProfitYen} /></strong>
              </div>
              <div className="result-hourly">
                <span className="label">実質時給</span>
                <strong className="num"><Money value={preview.hourlyYen} /></strong>
                {preview.hourlyYen !== null && <span className="unit">/時間</span>}
              </div>
            </div>
            <details>
              <summary className="hint">🧮 計算明細</summary>
              <dl className="stats">
                <div><dt>売上</dt><dd>{formatYen(preview.revenueYen)}</dd></div>
                <div><dt>− レンタル</dt><dd>{formatYen(preview.rentalYen)}</dd></div>
                <div><dt>− その他経費</dt><dd>{formatYen(preview.directExpenseYen)}</dd></div>
                <div><dt>売上時給（オンライン中）</dt><dd>{preview.onlineRevenueHourlyYen === null ? '算出不可' : `${formatYen(preview.onlineRevenueHourlyYen)}/時`}</dd></div>
              </dl>
            </details>
            <Problems items={preview.errors} />
          </>
        )}
        <p className="hint">
          税引前・出発〜帰宅の時間で計算。固定費・装備費は月の分析で反映
          {!s.returnedAt && '。帰宅が未入力なので、レンタルは今の時刻までの見積です'}
        </p>
      </section>

      <Problems items={problems} />
      <div className="settlement-actions">
        <button type="submit" className="primary" disabled={!s.returnedAt}>
          精算を保存
        </button>
        <button type="button" className="outline" onClick={() => void save('draft')}>
          下書き保存
        </button>
      </div>
    </form>
  )
}
