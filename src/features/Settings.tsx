// 設定（S01・S06・S07の一部）：基本・料金・装備と投資・固定費・データ
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Tariff } from '../domain'
import { CardTitle, IntInput, Notice, Problems, Select, TextInput, Tip, errorMessages, localToday } from '../components/fields'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { listTariffs, newId, saveRecurringExpense, saveSettings, saveTariff } from '../storage/repo'
import type { RecurringExpenseRecord, SettingsRecord, TariffRecord } from '../storage/schema'
import { AreaSettings } from './AreaSettings'
import { DataSettings } from './DataSettings'
import { Equipment } from './Equipment'

const SECTIONS = [
  { id: 'basic', label: '基本' },
  { id: 'tariff', label: '料金' },
  { id: 'equipment', label: '装備と投資' },
  { id: 'fixed', label: '固定費' },
  { id: 'area', label: 'エリア' },
  { id: 'data', label: 'データ' },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

export function Settings() {
  const [section, setSection] = useState<SectionId>('basic')
  return (
    <div className="stack">
      <div className="segmented wrap" role="tablist" aria-label="設定の項目">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {section === 'basic' && <BasicSettings />}
      {section === 'tariff' && <TariffSettings />}
      {section === 'equipment' && <Equipment />}
      {section === 'fixed' && <FixedCosts />}
      {section === 'area' && <AreaSettings />}
      {section === 'data' && <DataSettings />}
    </div>
  )
}

function BasicSettings() {
  const { db } = useData()
  const saved = useLiveQuery(() => db.settings.get('settings'), [db])
  const tariffs = useLiveQuery(() => listTariffs(db), [db]) ?? []
  const [form, setForm] = useState<SettingsRecord | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  // 目標の時給を入れたあとは、編集欄を畳んで要約だけを出す
  const [editing, setEditing] = useState<boolean | null>(null)
  useEffect(() => setForm(saved ?? null), [saved])
  if (!form || !saved) return <p className="loading">読み込み中…</p>
  const open = editing ?? saved.targetHourlyYen === null
  const set = (patch: Partial<SettingsRecord>) => setForm({ ...form, ...patch })
  const weeklyHours = form.weeklyBudgetMinutes === null ? null : Math.round(form.weeklyBudgetMinutes / 60)
  const tariffName = tariffs.find((t) => t.id === saved.defaultTariffId)?.name

  if (!open) {
    return (
      <div className="stack">
        {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
        <section className="card">
          <CardTitle
            right={
              <button type="button" className="icon" aria-label="基本設定を編集" onClick={() => setEditing(true)}>
                ✏️
              </button>
            }
          >
            🎯 基本
          </CardTitle>
          <dl className="stats">
            <div><dt>目標の営業純時給</dt><dd>{formatYen(saved.targetHourlyYen)}/時</dd></div>
            <div><dt>週に使える時間</dt><dd>{saved.weeklyBudgetMinutes === null ? '未設定' : `${Math.round(saved.weeklyBudgetMinutes / 60)}時間`}</dd></div>
            <div><dt>帰宅締切</dt><dd>{saved.homeDeadline ?? '未設定'}</dd></div>
            <div><dt>起点</dt><dd>{saved.originLabel ?? '未設定'}</dd></div>
            <div className="wide"><dt>よく使う料金</dt><dd>{tariffName ?? '未設定（一覧の先頭）'}</dd></div>
            <div className="wide"><dt>オファー判定</dt><dd>{saved.offerJudgeEnabled ? '使う（手入力）' : '使わない'}</dd></div>
          </dl>
        </section>
      </div>
    )
  }

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await saveSettings(db, form)
          setProblems([])
          setNotice('💾 保存しました')
          setEditing(null)
        } catch (err) {
          setProblems(errorMessages(err))
        }
      }}
    >
      <div className="row">
        <IntInput label="目標の営業純時給" unit="円/時" value={form.targetHourlyYen} onChange={(v) => set({ targetHourlyYen: v })} tip="出発〜帰宅の時間で割った、税引前の時給" />
        <IntInput label="週に使える時間" unit="時間" value={weeklyHours} onChange={(v) => set({ weeklyBudgetMinutes: v === null ? null : v * 60 })} tip="自宅との往復も含めた時間" />
      </div>
      <div className="row">
        <label className="field">
          <span>帰宅締切（任意）</span>
          <input type="time" value={form.homeDeadline ?? ''} onChange={(e) => set({ homeDeadline: e.target.value || null })} />
        </label>
        <TextInput label="起点の名前（任意）" value={form.originLabel ?? ''} onChange={(v) => set({ originLabel: v.trim() === '' ? null : v })} placeholder="例：〇〇駅周辺" tip="正確な住所は不要です" />
      </div>
      <Select
        label="よく使う料金"
        value={form.defaultTariffId ?? ''}
        options={[{ value: '', label: '未設定（一覧の先頭を使う）' }, ...tariffs.map((t) => ({ value: t.id, label: t.name }))]}
        onChange={(v) => set({ defaultTariffId: v || null })}
      />
      <div className="line">
        <label className="line grow">
          <input type="checkbox" className="check" checked={form.offerJudgeEnabled ?? false} onChange={(e) => set({ offerJudgeEnabled: e.target.checked })} />
          <span>オファー判定を使う（手入力）</span>
        </label>
        <Tip label="オファー判定の使い方">
          ホームに「🧾 オファー判定」が出ます。止まっている時に、配達アプリのオファーを見ながら報酬・分・km を手で入れると、受けるかの目安を出します。配達アプリの画面のスクリーンショットや、画面の読み取りは使いません（配達アプリから警告されることがあるため）。
        </Tip>
      </div>
      <Problems items={problems} />
      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
      <div className="actions">
        <button type="submit" className="primary">💾 保存</button>
        {saved.targetHourlyYen !== null && (
          <button type="button" onClick={() => (setForm(saved), setEditing(false))}>やめる</button>
        )}
      </div>
    </form>
  )
}

function TariffSettings() {
  const { db } = useData()
  const tariffs = useLiveQuery(() => listTariffs(db), [db])
  const [editing, setEditing] = useState<TariffRecord | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  if (!tariffs) return <p className="loading">読み込み中…</p>
  if (editing) return <TariffForm initial={editing} onDone={(m) => (setEditing(null), setNotice(m))} onCancel={() => setEditing(null)} />

  return (
    <div className="stack">
      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
      <section className="card">
        <CardTitle
          tip="料金は地域・事業者・車種・時期で変わります。プリセットは例なので、使うサービスの公式表示に合わせて編集してください。編集しても過去の記録の料金は変わりません。"
          right={
            <button
              type="button"
              className="icon"
              aria-label="料金を追加"
              onClick={() =>
          setEditing({
            id: '',
            name: '自分で入力した料金',
            tariff: { kind: 'tiered', initialMinutes: 30, initialYen: 0, stepMinutes: 15, stepYen: 0, capMinutes: 720, capYen: 0 },
            sourceUrl: null,
            verifiedAt: null,
            archived: false,
            createdAt: '',
            updatedAt: '',
                revision: 0,
              })
            }
            >
              ＋
            </button>
          }
        >
          🚲 レンタル料金
        </CardTitle>
        <ul className="list">
          {tariffs.map((t) => (
            <li key={t.id} className="line">
              <span className="grow">
                <strong>{t.name}</strong>
                <br />
                <span className="hint">
                  {describeTariff(t.tariff)}
                  {t.verifiedAt && `（確認 ${t.verifiedAt}）`}
                  {t.sourceUrl && (
                    <>
                      {' '}
                      <a href={t.sourceUrl} target="_blank" rel="noreferrer">出典</a>
                    </>
                  )}
                </span>
              </span>
              <button type="button" className="icon" aria-label={`${t.name}を編集`} onClick={() => setEditing(t)}>✏️</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function describeTariff(t: Tariff): string {
  if (t.kind === 'tiered') {
    return `${t.initialMinutes}分 ${formatYen(t.initialYen)}・以後${t.stepMinutes}分 ${formatYen(t.stepYen)}・上限 ${formatYen(t.capYen)}（${Math.round(t.capMinutes / 60)}時間まで）`
  }
  if (t.kind === 'pass') return t.passes.map((p) => `${p.minutes / 60}時間 ${formatYen(p.yen)}`).join('・')
  return '貸出ごとの料金なし'
}

function TariffForm({ initial, onDone, onCancel }: { initial: TariffRecord; onDone: (m: string) => void; onCancel: () => void }) {
  const { db } = useData()
  const [t, setT] = useState(initial)
  const [problems, setProblems] = useState<string[]>([])
  const tariff = t.tariff
  const setTariff = (next: Tariff) => setT({ ...t, tariff: next })

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await saveTariff(db, { id: t.id || undefined, name: t.name, tariff: t.tariff, sourceUrl: t.sourceUrl, verifiedAt: t.verifiedAt })
          onDone('💾 料金を保存しました（過去の記録はそのまま）')
        } catch (err) {
          setProblems(errorMessages(err))
        }
      }}
    >
      <TextInput label="名前" value={t.name} onChange={(v) => setT({ ...t, name: v })} />
      <Select
        label="料金の種類"
        value={tariff.kind}
        options={[
          { value: 'tiered', label: '時間で上がる（段階料金）' },
          { value: 'pass', label: '時間パス' },
          { value: 'none', label: '貸出ごとの料金なし（自前・サブスク）' },
        ]}
        onChange={(kind) =>
          setTariff(
            kind === 'tiered'
              ? { kind, initialMinutes: 30, initialYen: 0, stepMinutes: 15, stepYen: 0, capMinutes: 720, capYen: 0 }
              : kind === 'pass'
                ? { kind, passes: [{ minutes: 180, yen: 0 }] }
                : { kind },
          )
        }
      />
      {tariff.kind === 'tiered' && (
        <>
          <div className="row">
            <IntInput label="最初の時間" unit="分" value={tariff.initialMinutes} onChange={(v) => setTariff({ ...tariff, initialMinutes: v ?? 0 })} />
            <IntInput label="最初の料金" unit="円" value={tariff.initialYen} onChange={(v) => setTariff({ ...tariff, initialYen: v ?? 0 })} />
          </div>
          <div className="row">
            <IntInput label="加算の単位" unit="分" value={tariff.stepMinutes} onChange={(v) => setTariff({ ...tariff, stepMinutes: v ?? 0 })} />
            <IntInput label="加算の料金" unit="円" value={tariff.stepYen} onChange={(v) => setTariff({ ...tariff, stepYen: v ?? 0 })} />
          </div>
          <div className="row">
            <IntInput label="上限の対象時間" unit="分" value={tariff.capMinutes} onChange={(v) => setTariff({ ...tariff, capMinutes: v ?? 0 })} />
            <IntInput label="上限料金" unit="円" value={tariff.capYen} onChange={(v) => setTariff({ ...tariff, capYen: v ?? 0 })} />
          </div>
        </>
      )}
      {tariff.kind === 'pass' && (
        <>
          {tariff.passes.map((p, i) => (
            <div key={i} className="row">
              <IntInput label="パスの時間" unit="分" value={p.minutes} onChange={(v) => setTariff({ ...tariff, passes: tariff.passes.map((x, j) => (j === i ? { ...x, minutes: v ?? 0 } : x)) })} />
              <IntInput label="料金" unit="円" value={p.yen} onChange={(v) => setTariff({ ...tariff, passes: tariff.passes.map((x, j) => (j === i ? { ...x, yen: v ?? 0 } : x)) })} />
            </div>
          ))}
          <button type="button" onClick={() => setTariff({ ...tariff, passes: [...tariff.passes, { minutes: 360, yen: 0 }] })}>＋ パスを追加</button>
        </>
      )}
      <div className="row">
        <TextInput label="出典URL（任意）" value={t.sourceUrl ?? ''} onChange={(v) => setT({ ...t, sourceUrl: v || null })} />
        <label className="field">
          <span>確認日</span>
          <input type="date" value={t.verifiedAt ?? ''} onChange={(e) => setT({ ...t, verifiedAt: e.target.value || null })} />
        </label>
      </div>
      <Problems items={problems} />
      <div className="actions">
        <button type="submit" className="primary">💾 保存</button>
        <button type="button" onClick={onCancel}>やめる</button>
      </div>
    </form>
  )
}

function FixedCosts() {
  const { db } = useData()
  const items = useLiveQuery(() => db.recurringExpenses.toArray(), [db])
  const thisMonth = localToday().slice(0, 7)
  const blank = (): RecurringExpenseRecord => ({ id: newId(), label: '', category: 'communication', amountYen: 0, startMonth: thisMonth, endMonth: null, createdAt: '', updatedAt: '', revision: 0 })
  // 編集欄は「＋」か ✏️ を押した時だけ開く（一覧は1行ずつ）
  const [form, setForm] = useState<RecurringExpenseRecord | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null)
  if (!items) return <p className="loading">読み込み中…</p>

  return (
    <div className="stack">
      {notice && <Notice message={notice.message} onUndo={notice.undo} onClose={() => setNotice(null)} />}
      <section className="card">
        <CardTitle
          tip="通信費・保険・自転車のサブスクなど、毎月かかる費用（業務で使う分）。稼働した時間の比で、その月の記録に配ります。稼働しなかった月も損益に残ります。"
          right={
            <button type="button" className="icon" aria-label="固定費を追加" onClick={() => setForm(blank())}>＋</button>
          }
        >
          📶 毎月の固定費
        </CardTitle>
        {items.length === 0 && <p className="hint">まだありません（＋で追加）</p>}
        <ul className="list">
          {items.map((e) => (
            <li key={e.id} className="line">
              <span className="grow">
                {e.label} <span className="hint">{e.startMonth}〜{e.endMonth ?? ''}</span>
              </span>
              <span className="num">{formatYen(e.amountYen)}/月</span>
              <button type="button" className="icon" aria-label={`${e.label}を編集`} onClick={() => setForm(e)}>✏️</button>
              <button
                type="button"
                className="icon danger-text"
                aria-label={`${e.label}を削除`}
                onClick={async () => {
                  await db.recurringExpenses.delete(e.id)
                  setNotice({ message: '🗑️ 削除しました', undo: () => void db.recurringExpenses.put(e).then(() => setNotice(null)) })
                }}
              >
                🗑️
              </button>
            </li>
          ))}
        </ul>
      </section>
      {form && (
      <form
        className="card stack"
        onSubmit={async (ev) => {
          ev.preventDefault()
          try {
            await saveRecurringExpense(db, form)
            setForm(null)
            setProblems([])
          } catch (err) {
            setProblems(errorMessages(err))
          }
        }}
      >
        <h3>{items.some((i) => i.id === form.id) ? '固定費を編集' : '固定費を追加'}</h3>
        <TextInput label="名前" value={form.label} onChange={(v) => setForm({ ...form, label: v })} placeholder="例：スマホ代（業務分）" />
        <div className="row">
          <Select
            label="分類"
            value={form.category}
            options={[
              { value: 'communication', label: '📶 通信' },
              { value: 'insurance', label: '🛡️ 保険' },
              { value: 'subscription', label: '🚲 サブスク' },
              { value: 'other', label: '📦 その他' },
            ]}
            onChange={(v) => setForm({ ...form, category: v })}
          />
          <IntInput label="金額（月）" unit="円" value={form.amountYen} onChange={(v) => setForm({ ...form, amountYen: v ?? 0 })} />
        </div>
        <div className="row">
          <label className="field">
            <span>開始月</span>
            <input type="month" value={form.startMonth} onChange={(e) => setForm({ ...form, startMonth: e.target.value })} />
          </label>
          <label className="field">
            <span>終了月（任意）</span>
            <input type="month" value={form.endMonth ?? ''} onChange={(e) => setForm({ ...form, endMonth: e.target.value || null })} />
          </label>
        </div>
        <Problems items={problems} />
        <div className="actions">
          <button type="submit" className="primary">💾 保存</button>
          <button type="button" onClick={() => (setForm(null), setProblems([]))}>やめる</button>
        </div>
      </form>
      )}
    </div>
  )
}
