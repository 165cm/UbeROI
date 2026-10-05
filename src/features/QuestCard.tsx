// ホームの「🎯 クエスト」：今の期間のクエストの進み具合（見込みの管理用。実績の売上には自動で入れない）
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { questProgress, selectiveQuestPeriod, type Platform } from '../domain'
import { CardTitle, DateTimeInput, IntInput, Notice, Problems, Select, TextInput, errorMessages, localToday } from '../components/fields'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { newId, saveQuest } from '../storage/repo'
import { PLATFORM_LABELS, type QuestRecord } from '../storage/schema'

function periodText(q: { startsAt: string; endsAt: string }): string {
  const f = (iso: string) => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return `${f(q.startsAt)}〜${f(q.endsAt)}`
}

function blankQuest(nowIso: string): QuestRecord {
  const period = selectiveQuestPeriod(nowIso)
  return {
    id: newId(),
    label: `選択制クエスト（${period.label.slice(0, 2)}）`,
    platform: 'uber',
    startsAt: period.startsAt,
    endsAt: period.endsAt,
    rewardMode: 'incremental',
    tiers: [{ count: 10, rewardYen: 0 }],
    manualOffset: 0,
    createdAt: '',
    updatedAt: '',
    revision: 0,
  }
}

export function QuestCard({ now }: { now: string }) {
  const { db } = useData()
  const data = useLiveQuery(async () => ({ quests: await db.quests.toArray(), sessions: await db.sessions.toArray() }), [db])
  const [editing, setEditing] = useState<QuestRecord | null>(null)
  const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null)
  if (!data) return null

  const nowMs = Date.parse(now)
  // 今の期間のもの・これから始まるもの（入力の誤りを直せるように）・終わってから1日以内のもの（達成分の入れ忘れ防止）を出す
  const visible = data.quests
    .filter((q) => nowMs < Date.parse(q.endsAt) + 86_400_000)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.endsAt.localeCompare(b.endsAt))

  return (
    <section className="card stack" aria-labelledby="quest-title">
      <CardTitle
        id="quest-title"
        tip="配達アプリで選んだクエストの段階を入れると、期間内に帰宅した確定記録の件数から「あと何件で次の段階か」を出します。達成分は見込みなので、報酬が確定したら精算の「確定ボーナス」に入れてください。"
        right={
          !editing && (
            <button type="button" className="icon" aria-label="クエストを追加" onClick={() => setEditing(blankQuest(now))}>
              ＋
            </button>
          )
        }
      >
        🎯 クエスト
      </CardTitle>
      {notice && <Notice message={notice.message} onUndo={notice.undo} onClose={() => setNotice(null)} />}
      {editing ? (
        <QuestForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={async (q) => {
            await saveQuest(db, q)
            setEditing(null)
            setNotice({ message: '💾 クエストを保存しました' })
          }}
        />
      ) : (
        <>
          {visible.length === 0 && <p className="hint">今の期間のクエストはありません（＋で追加）</p>}
          {visible.map((q) => {
            const p = questProgress(
              q,
              data.sessions.map((s) => ({ status: s.status, returnedAt: s.returnedAt, completedCount: s.completedCount, eligible: s.platform === q.platform })),
              now,
            )
            const target = p.next ? p.count + p.next.remaining : q.tiers[q.tiers.length - 1]?.count ?? p.count
            const upcoming = nowMs < Date.parse(q.startsAt)
            return (
              <div key={q.id} className="subcard">
                <div className="line">
                  <strong className="grow">{q.label}</strong>
                  <span className="tag">{p.ended ? '⌛ 終了' : upcoming ? '🕒 これから' : PLATFORM_LABELS[q.platform]}</span>
                  <button type="button" className="icon" aria-label={`${q.label}を編集・件数の調整`} onClick={() => setEditing(q)}>✏️</button>
                  <button
                    type="button"
                    className="icon danger-text"
                    aria-label={`${q.label}を削除`}
                    onClick={async () => {
                      await db.quests.delete(q.id)
                      setNotice({ message: '🗑️ 削除しました', undo: () => void db.quests.put(q).then(() => setNotice(null)) })
                    }}
                  >
                    🗑️
                  </button>
                </div>
                <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={target} aria-valuenow={p.count} aria-label="クエストの件数">
                  <span style={{ width: `${Math.min(100, (p.count / Math.max(1, target)) * 100)}%` }} />
                </div>
                <p className="line">
                  <span className="grow">
                    <strong>{p.count}件</strong>
                    {p.next ? `／あと${p.next.remaining}件で+${formatYen(p.next.gainYen)}` : '／全段階を達成'}
                    {p.earnedYen > 0 && <span className="hint">（達成 {formatYen(p.earnedYen)}・見込み）</span>}
                  </span>
                  <span className="hint">{periodText(q)}</span>
                </p>
                {p.unknownCountSessions > 0 && <p className="hint">⚠️ 件数未入力の記録{p.unknownCountSessions}件は数えていません</p>}
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}

function QuestForm({ initial, onSave, onCancel }: { initial: QuestRecord; onSave: (q: QuestRecord) => Promise<void>; onCancel: () => void }) {
  const [q, setQ] = useState(initial)
  const [problems, setProblems] = useState<string[]>([])
  const today = localToday()
  const peak = (start: string, end: string, label: string) => {
    setQ({ ...q, label, startsAt: new Date(`${today}T${start}`).toISOString(), endsAt: new Date(`${today}T${end}`).toISOString() })
  }

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await onSave(q)
        } catch (err) {
          setProblems(errorMessages(err))
        }
      }}
    >
      <div className="row">
        <TextInput label="名前" value={q.label} onChange={(v) => setQ({ ...q, label: v })} />
        <Select
          label="対象のサービス"
          value={q.platform}
          options={(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))}
          onChange={(v) => setQ({ ...q, platform: v })}
        />
      </div>
      <div className="buttons" role="group" aria-label="期間をすばやく入れる">
        <button type="button" onClick={() => setQ({ ...q, ...selectiveQuestPeriod(new Date().toISOString()), label: q.label })}>選択制（今の期間）</button>
        <button type="button" onClick={() => peak('10:30', '15:00', '今日のランチピーク')}>今日のランチ</button>
        <button type="button" onClick={() => peak('17:00', '21:30', '今日のディナーピーク')}>今日のディナー</button>
      </div>
      <div className="row">
        <DateTimeInput label="開始" value={q.startsAt} onChange={(v) => v && setQ({ ...q, startsAt: v })} />
        <DateTimeInput label="終了" value={q.endsAt} onChange={(v) => v && setQ({ ...q, endsAt: v })} />
      </div>
      <Select
        label="報酬の書き方"
        value={q.rewardMode}
        options={[
          { value: 'incremental', label: '段階ごとに上乗せされる額' },
          { value: 'cumulative', label: '段階を達成した時の合計額' },
        ]}
        onChange={(v) => setQ({ ...q, rewardMode: v })}
        tip="配達アプリの表示に合わせて選んでください"
      />
      {q.tiers.map((t, i) => (
        <div key={i} className="row">
          <IntInput label={`第${i + 1}段階の件数`} unit="件" value={t.count} onChange={(v) => setQ({ ...q, tiers: q.tiers.map((x, j) => (j === i ? { ...x, count: v ?? 0 } : x)) })} />
          <IntInput label="報酬" unit="円" value={t.rewardYen} onChange={(v) => setQ({ ...q, tiers: q.tiers.map((x, j) => (j === i ? { ...x, rewardYen: v ?? 0 } : x)) })} />
          {q.tiers.length > 1 && (
            <button type="button" className="danger-text" aria-label={`第${i + 1}段階を外す`} onClick={() => setQ({ ...q, tiers: q.tiers.filter((_, j) => j !== i) })}>
              ✕
            </button>
          )}
        </div>
      ))}
      <button type="button" onClick={() => setQ({ ...q, tiers: [...q.tiers, { count: (q.tiers[q.tiers.length - 1]?.count ?? 0) + 10, rewardYen: 0 }] })}>
        ＋ 段階を追加
      </button>
      <IntInput
        label="件数の調整（±）"
        unit="件"
        allowNegative
        value={q.manualOffset}
        onChange={(v) => setQ({ ...q, manualOffset: v ?? 0 })}
        tip="記録していない配達の分を足します（配達アプリの件数と合わせる時に使います）"
      />
      <Problems items={problems} />
      <div className="actions">
        <button type="submit" className="primary">💾 保存</button>
        <button type="button" onClick={onCancel}>やめる</button>
      </div>
    </form>
  )
}
