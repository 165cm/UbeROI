// 設定（S01・S06・S07の一部）：基本・料金・装備と投資・固定費・データ
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Tariff } from '../domain'
import { IntInput, Notice, Problems, Select, TextInput, errorMessages } from '../components/fields'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { listTariffs, newId, saveRecurringExpense, saveSettings, saveTariff } from '../storage/repo'
import { SCHEMA_VERSION, type RecurringExpenseRecord, type SettingsRecord, type TariffRecord } from '../storage/schema'
import { Equipment } from './Equipment'

const SECTIONS = [
  { id: 'basic', label: '基本' },
  { id: 'tariff', label: '料金' },
  { id: 'equipment', label: '装備と投資' },
  { id: 'fixed', label: '固定費' },
  { id: 'data', label: 'データ' },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

export function Settings() {
  const [section, setSection] = useState<SectionId>('basic')
  return (
    <div className="stack">
      <div className="segmented scroll" role="tablist" aria-label="設定の項目">
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
  useEffect(() => setForm(saved ?? null), [saved])
  if (!form) return <p className="loading">読み込み中…</p>
  const set = (patch: Partial<SettingsRecord>) => setForm({ ...form, ...patch })
  const weeklyHours = form.weeklyBudgetMinutes === null ? null : Math.round(form.weeklyBudgetMinutes / 60)

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await saveSettings(db, form)
          setProblems([])
          setNotice('💾 保存しました')
        } catch (err) {
          setProblems(errorMessages(err))
        }
      }}
    >
      <TextInput label="起点の名前（任意）" value={form.originLabel ?? ''} onChange={(v) => set({ originLabel: v.trim() === '' ? null : v })} placeholder="例：〇〇駅周辺" hint="正確な住所は不要です" />
      <IntInput label="目標の営業純時給" unit="円/時" value={form.targetHourlyYen} onChange={(v) => set({ targetHourlyYen: v })} hint="出発〜帰宅の時間で割った、税引前の時給" />
      <IntInput label="週に使える時間" unit="時間" value={weeklyHours} onChange={(v) => set({ weeklyBudgetMinutes: v === null ? null : v * 60 })} hint="自宅との往復も含めた時間" />
      <label className="field">
        <span>帰宅締切（任意）</span>
        <input type="time" value={form.homeDeadline ?? ''} onChange={(e) => set({ homeDeadline: e.target.value || null })} />
      </label>
      <Select
        label="よく使う料金"
        value={form.defaultTariffId ?? ''}
        options={[{ value: '', label: '未設定（一覧の先頭を使う）' }, ...tariffs.map((t) => ({ value: t.id, label: t.name }))]}
        onChange={(v) => set({ defaultTariffId: v || null })}
      />
      <Problems items={problems} />
      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
      <button type="submit" className="primary">💾 保存</button>
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
      <p className="hint">料金は地域・事業者・車種・時期で変わります。プリセットは例なので、使うサービスの公式表示に合わせて編集してください。編集しても過去の記録の料金は変わりません。</p>
      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
      {tariffs.map((t) => (
        <section key={t.id} className="card stack">
          <strong>{t.name}</strong>
          <p className="hint">{describeTariff(t.tariff)}</p>
          <p className="hint">
            {t.verifiedAt ? `確認日 ${t.verifiedAt}` : '確認日 未設定'}
            {t.sourceUrl && (
              <>
                {'・'}
                <a href={t.sourceUrl} target="_blank" rel="noreferrer">出典</a>
              </>
            )}
          </p>
          <button type="button" onClick={() => setEditing(t)}>✏️ 編集</button>
        </section>
      ))}
      <button
        type="button"
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
        ＋ 料金を追加
      </button>
    </div>
  )
}

function describeTariff(t: Tariff): string {
  if (t.kind === 'tiered') {
    return `最初の${t.initialMinutes}分 ${formatYen(t.initialYen)}、以後${t.stepMinutes}分ごと ${formatYen(t.stepYen)}、${Math.round(t.capMinutes / 60)}時間まで上限 ${formatYen(t.capYen)}`
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
      <TextInput label="出典URL（任意）" value={t.sourceUrl ?? ''} onChange={(v) => setT({ ...t, sourceUrl: v || null })} />
      <label className="field">
        <span>確認日</span>
        <input type="date" value={t.verifiedAt ?? ''} onChange={(e) => setT({ ...t, verifiedAt: e.target.value || null })} />
      </label>
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
  const thisMonth = new Date().toISOString().slice(0, 7)
  const blank = (): RecurringExpenseRecord => ({ id: newId(), label: '', category: 'communication', amountYen: 0, startMonth: thisMonth, endMonth: null, createdAt: '', updatedAt: '', revision: 0 })
  const [form, setForm] = useState<RecurringExpenseRecord>(blank)
  const [problems, setProblems] = useState<string[]>([])
  const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null)
  if (!items) return <p className="loading">読み込み中…</p>

  return (
    <div className="stack">
      <p className="hint">通信費・保険・自転車のサブスクなど、毎月かかる費用（業務で使う分）。稼働した時間の比で、その月の記録に配ります。稼働しなかった月も損益に残ります。</p>
      {notice && <Notice message={notice.message} onUndo={notice.undo} onClose={() => setNotice(null)} />}
      {items.map((e) => (
        <section key={e.id} className="card row-between">
          <span>
            {e.label}：{formatYen(e.amountYen)}/月
            <span className="hint"> {e.startMonth}〜{e.endMonth ?? ''}</span>
          </span>
          <span className="row">
            <button type="button" onClick={() => setForm(e)}>✏️</button>
            <button
              type="button"
              className="danger-text"
              aria-label={`${e.label}を削除`}
              onClick={async () => {
                await db.recurringExpenses.delete(e.id)
                setNotice({ message: '🗑️ 削除しました', undo: () => void db.recurringExpenses.put(e).then(() => setNotice(null)) })
              }}
            >
              ✕
            </button>
          </span>
        </section>
      ))}
      <form
        className="card stack"
        onSubmit={async (ev) => {
          ev.preventDefault()
          try {
            await saveRecurringExpense(db, form)
            setForm(blank())
            setProblems([])
          } catch (err) {
            setProblems(errorMessages(err))
          }
        }}
      >
        <h3>{items.some((i) => i.id === form.id) ? '固定費を編集' : '固定費を追加'}</h3>
        <TextInput label="名前" value={form.label} onChange={(v) => setForm({ ...form, label: v })} placeholder="例：スマホ代（業務分）" />
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
        <button type="submit" className="primary">💾 保存</button>
      </form>
    </div>
  )
}

function DataSettings() {
  const { db, mode, setMode } = useData()
  const [problems, setProblems] = useState<string[]>([])

  const exportJson = async () => {
    try {
      const datasets = {
        settings: await db.settings.toArray(),
        tariffs: await db.tariffs.toArray(),
        sessions: await db.sessions.toArray(),
        recurringExpenses: await db.recurringExpenses.toArray(),
        plans: await db.plans.toArray(),
        assets: await db.assets.toArray(),
      }
      const body = JSON.stringify({ schema_version: SCHEMA_VERSION, exported_at: new Date().toISOString(), app_version: '0.1.0', mode, datasets }, null, 2)
      const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `deli-kan-${mode === 'demo' ? 'demo-' : ''}${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setProblems(errorMessages(e))
    }
  }

  return (
    <div className="stack">
      <section className="card stack">
        <h3>🧪 表示するデータ</h3>
        <p className="hint">デモは合成データで、実績とは別の場所に保存されます。切り替えても実績は消えません。</p>
        <div className="segmented" role="radiogroup" aria-label="表示するデータ">
          <button type="button" role="radio" aria-checked={mode === 'real'} onClick={() => setMode('real')}>📒 自分の実績</button>
          <button type="button" role="radio" aria-checked={mode === 'demo'} onClick={() => setMode('demo')}>🧪 デモ</button>
        </div>
      </section>
      <section className="card stack">
        <h3>💾 バックアップ</h3>
        <p className="hint">データはこの端末のブラウザーの中だけにあります（外部へは送りません。暗号化はしていません）。端末の初期化やブラウザーのデータ削除で消えるので、ときどき書き出してください。復元機能は次の更新で追加します。</p>
        <button type="button" onClick={() => void exportJson()}>⬇️ JSONで書き出す</button>
        <Problems items={problems} />
      </section>
    </div>
  )
}
