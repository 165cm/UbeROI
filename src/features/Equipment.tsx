// 設定・初期投資（S06）：初級／中級／上級は代替案。購入・所有した物だけが実績（資産）になる
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { summarizePlan, type EquipmentCategory } from '../domain'
import { IntInput, Notice, Problems, Select, TextInput, errorMessages, localToday } from '../components/fields'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { EQUIPMENT_PRESETS, VEHICLE_PRESET } from '../storage/presets'
import { acquirePlanItem, applyPreset, deleteAsset, newId, planItemFromPreset, savePlan } from '../storage/repo'
import { CATEGORY_LABELS, type EquipmentPlanRecord, type PlanItemRecord } from '../storage/schema'
import { recoveryFor } from '../storage/toDomain'

const TIERS = ['beginner', 'intermediate', 'advanced'] as const
const STATE_LABELS: Record<PlanItemRecord['state'], string> = { planned: '🗓️ 予定', purchased: '🧾 購入済み', owned: '🏠 所有済み' }

export function Equipment() {
  const { db } = useData()
  const plans = useLiveQuery(() => db.plans.toArray(), [db])
  const assets = useLiveQuery(() => db.assets.toArray(), [db])
  const snapshot = useLiveQuery(async () => ({
    sessions: await db.sessions.toArray(),
    recurringExpenses: await db.recurringExpenses.toArray(),
    assets: await db.assets.toArray(),
  }), [db])
  const [tier, setTier] = useState<(typeof TIERS)[number]>('beginner')
  const saved = plans?.find((p) => p.tier === tier)
  const [draft, setDraft] = useState<EquipmentPlanRecord | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [acquiring, setAcquiring] = useState<{ itemId: string; mode: 'purchased' | 'owned'; date: string; value: number | null } | null>(null)

  // 保存済みのプランが変わったら（別の段階を選んだ時など）、編集中の内容を読み直す
  useEffect(() => {
    setDraft(saved ? structuredClone(saved) : null)
    setProblems([])
  }, [saved])

  const summary = useMemo(() => {
    try {
      return draft ? summarizePlan(draft.items) : null
    } catch {
      return null
    }
  }, [draft])

  if (!plans || !assets || !snapshot || !draft) return <p className="loading">読み込み中…</p>

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const recovery = recoveryFor(snapshot, new Date().toISOString())
  const updateItem = (id: string, patch: Partial<PlanItemRecord>) =>
    setDraft({ ...draft, items: draft.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })

  const save = async () => {
    try {
      await savePlan(db, draft)
      setProblems([])
      setNotice('💾 プランを保存しました')
    } catch (e) {
      setProblems(errorMessages(e))
    }
  }

  return (
    <div className="stack">
      <div className="segmented" role="tablist" aria-label="装備の段階">
        {TIERS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tier === t}
            onClick={() => {
              if (dirty && !window.confirm('保存していない変更があります。破棄して切り替えますか？')) return
              setTier(t)
            }}
          >
            {EQUIPMENT_PRESETS[t].name}
          </button>
        ))}
      </div>

      <section className="card">
        <h3>{draft.name}プラン</h3>
        <p className="hint">3つの段階は「どれか1つを選ぶ」ための比較です。合計はしません。</p>
        {summary && (
          <dl className="stats">
            <div><dt>セット総額</dt><dd className="big">{formatYen(summary.totalYen)}</dd></div>
            <div><dt>これから必要な現金</dt><dd>{formatYen(summary.cashNeededYen)}</dd></div>
            <div><dt>所有済みの額</dt><dd>{formatYen(summary.ownedYen)}</dd></div>
            {summary.unpricedCount > 0 && <div><dt>価格未設定</dt><dd>{summary.unpricedCount}品目（総額に含めていません）</dd></div>}
          </dl>
        )}
      </section>

      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}

      {draft.items.map((item) => {
        const locked = item.assetId !== null
        return (
          <section key={item.id} className="card stack">
            <div className="row-between">
              <strong>{CATEGORY_LABELS[item.category]}</strong>
              <span className="tag">{STATE_LABELS[item.state]}</span>
            </div>
            <TextInput label="品目" value={item.label} onChange={(v) => updateItem(item.id, { label: v })} />
            <Select
              label="分類"
              value={item.category}
              options={(Object.keys(CATEGORY_LABELS) as EquipmentCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
              onChange={(v) => updateItem(item.id, { category: v })}
            />
            <IntInput label="価格（税込・1個）" unit="円" value={item.unitYen} onChange={(v) => updateItem(item.id, { unitYen: v })} hint={locked ? '登録済みの資産の額は変わりません' : '分からなければ空欄（0円＝無料とは別）'} />
            <div className="row">
              <IntInput label="数量" value={item.quantity} onChange={(v) => updateItem(item.id, { quantity: v ?? 1 })} />
              <IntInput label="業務で使う割合" unit="%" value={Math.round(item.businessRatioBps / 100)} onChange={(v) => updateItem(item.id, { businessRatioBps: (v ?? 0) * 100 })} />
            </div>
            <div className="row">
              <IntInput label="配賦期間" unit="か月" value={item.lifetimeMonths} onChange={(v) => updateItem(item.id, { lifetimeMonths: v ?? 1 })} />
              <IntInput label="想定残存額" unit="円" value={item.residualYen} onChange={(v) => updateItem(item.id, { residualYen: v ?? 0 })} />
            </div>
            {!locked && (
              <div className="row">
                <button type="button" onClick={() => setAcquiring({ itemId: item.id, mode: 'purchased', date: localToday(), value: null })}>
                  🧾 購入した
                </button>
                <button type="button" onClick={() => setAcquiring({ itemId: item.id, mode: 'owned', date: localToday().slice(0, 7), value: null })}>
                  🏠 前から持っている
                </button>
                <button type="button" className="danger-text" onClick={() => setDraft({ ...draft, items: draft.items.filter((i) => i.id !== item.id) })}>
                  外す
                </button>
              </div>
            )}
            {acquiring?.itemId === item.id && (
              <div className="subcard stack">
                {acquiring.mode === 'purchased' ? (
                  <label className="field">
                    <span>購入日</span>
                    <input type="date" value={acquiring.date} onChange={(e) => setAcquiring({ ...acquiring, date: e.target.value })} />
                  </label>
                ) : (
                  <>
                    <label className="field">
                      <span>配達に使い始めた月</span>
                      <input type="month" value={acquiring.date} onChange={(e) => setAcquiring({ ...acquiring, date: e.target.value })} />
                    </label>
                    <IntInput label="管理用の価値（任意）" unit="円" value={acquiring.value} onChange={(v) => setAcquiring({ ...acquiring, value: v })} hint="今回の支出は0円。入力すると、その額を月ごとに配賦します" />
                  </>
                )}
                <button
                  type="button"
                  className="primary"
                  onClick={async () => {
                    try {
                      if (dirty) await savePlan(db, draft)
                      await acquirePlanItem(
                        db,
                        draft.id,
                        item.id,
                        acquiring.mode === 'purchased'
                          ? { state: 'purchased', purchasedAt: `${acquiring.date}T12:00:00+09:00` }
                          : { state: 'owned', managementValueYen: acquiring.value, inServiceMonth: acquiring.date },
                      )
                      setAcquiring(null)
                      setNotice(acquiring.mode === 'purchased' ? '🧾 購入として登録しました。回収の計算に入ります' : '🏠 所有済みとして登録しました')
                    } catch (e) {
                      setProblems(errorMessages(e))
                    }
                  }}
                >
                  登録する
                </button>
                <button type="button" onClick={() => setAcquiring(null)}>やめる</button>
              </div>
            )}
          </section>
        )
      })}

      <Problems items={problems} />
      <div className="actions">
        <button type="button" className="primary" disabled={!dirty} onClick={() => void save()}>
          💾 保存
        </button>
        <button type="button" disabled={!dirty} onClick={() => setDraft(structuredClone(saved!))}>
          ↩ 変更を取り消す
        </button>
        <button type="button" onClick={() => setDraft({ ...draft, items: [...draft.items, { ...planItemFromPreset({ label: '', category: 'other', lifetimeMonths: 24 }), id: newId() }] })}>
          ＋ 明細を追加
        </button>
        <button type="button" onClick={() => setDraft({ ...draft, items: [...draft.items, planItemFromPreset(VEHICLE_PRESET)] })}>
          🚲 車両を追加
        </button>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm(`${EQUIPMENT_PRESETS[tier].name}のプリセットをコピーし直しますか？予定の品目は置き換わり、購入済み・所有済みは残ります。`)) return
            setDraft(applyPreset(draft, EQUIPMENT_PRESETS[tier].items))
          }}
        >
          📋 プリセットをコピー
        </button>
      </div>

      <section className="card">
        <h3>💰 投資の回収（実績・現金ベース）</h3>
        {recovery.investedYen === 0 ? (
          <p className="hint">購入した装備はまだありません。「購入した」で登録すると、ここに回収状況が出ます。</p>
        ) : (
          <dl className="stats">
            <div><dt>現金投資</dt><dd>{formatYen(recovery.investedYen)}</dd></div>
            <div><dt>累積の営業余剰</dt><dd>{formatYen(recovery.cashSurplusYen)}</dd></div>
            <div><dt>回収残額</dt><dd className="big">{formatYen(recovery.remainingYen)}</dd></div>
            <div><dt>回収率</dt><dd>{recovery.recoveryRate === null ? '算出不可' : `${(recovery.recoveryRate * 100).toFixed(1)}%`}</dd></div>
          </dl>
        )}
      </section>

      <section className="card stack">
        <h3>📦 登録済みの装備（資産）</h3>
        {assets.length === 0 && <p className="hint">まだありません。</p>}
        {assets.map((a) => (
          <div key={a.id} className="row-between">
            <span>
              {CATEGORY_LABELS[a.category]} {a.label}
              <span className="hint">
                {' '}
                {a.status === 'purchased' ? `購入 ${a.purchasedAt?.slice(0, 10)}・${formatYen(Math.round((a.unitYen * a.quantity * a.businessRatioBps) / 10000))}` : `所有・価値 ${formatYen(a.managementValueYen ?? 0)}`}
              </span>
            </span>
            <button
              type="button"
              className="danger-text"
              onClick={async () => {
                if (!window.confirm(`「${a.label}」の登録を消しますか？プランの品目は「予定」に戻ります。`)) return
                await deleteAsset(db, a.id)
                setNotice('🗑️ 登録を消しました')
              }}
            >
              消す
            </button>
          </div>
        ))}
      </section>
    </div>
  )
}
