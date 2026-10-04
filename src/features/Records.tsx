// 記録の一覧と編集・削除（削除は確認と直後の取り消しつき）
import { useCallback, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { calculateSession } from '../domain'
import { Notice } from '../components/fields'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { deleteSession, emptySession, restoreSession } from '../storage/repo'
import { PLATFORM_LABELS, WEATHER_LABELS, type SessionRecord } from '../storage/schema'
import { sessionToInput } from '../storage/toDomain'
import { SessionForm } from './SessionForm'

const STATUS_LABELS: Record<SessionRecord['status'], string> = {
  active: '🟢 稼働中',
  draft: '📝 下書き',
  completed: '✅ 確定',
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

export function Records({ editId, onEdit }: { editId: string | null; onEdit: (id: string | null) => void }) {
  const { db } = useData()
  const sessions = useLiveQuery(() => db.sessions.orderBy('departedAt').reverse().toArray(), [db])
  const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null)
  const [creating, setCreating] = useState<SessionRecord | null>(null)
  const closeNotice = useCallback(() => setNotice(null), [])

  if (!sessions) return <p className="loading">読み込み中…</p>

  const editing = creating ?? (editId ? sessions.find((s) => s.id === editId) : undefined)
  if (editing) {
    return (
      <div className="stack">
        <button type="button" className="link back" onClick={() => (setCreating(null), onEdit(null))}>
          ← 一覧へ戻る
        </button>
        <h3>{creating ? '記録を追加' : `${formatDateTime(editing.departedAt)} の記録`}</h3>
        <SessionForm
          key={editing.id}
          initial={editing}
          onDone={(message) => {
            setCreating(null)
            onEdit(null)
            setNotice({ message })
          }}
        />
        {!creating && (
          <button
            type="button"
            className="danger"
            onClick={async () => {
              if (!window.confirm('この記録を削除しますか？')) return
              const deleted = await deleteSession(db, editing.id)
              onEdit(null)
              if (deleted) setNotice({ message: '🗑️ 削除しました', undo: () => void restoreSession(db, deleted).then(() => setNotice(null)) })
            }}
          >
            🗑️ この記録を削除
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="stack">
      {notice && <Notice message={notice.message} onUndo={notice.undo} onClose={closeNotice} />}
      <button type="button" onClick={() => setCreating(emptySession(new Date(Date.now() - 3 * 3_600_000).toISOString(), 'draft'))}>
        ＋ 過去の稼働をまとめて入力
      </button>
      {sessions.length === 0 ? (
        <section className="card muted">
          <h3>まだ記録がありません</h3>
          <p>ホームの「出発」から始めるか、上のボタンで過去の稼働を入力してください。</p>
        </section>
      ) : (
        <ul className="list">
          {sessions.map((s) => {
            let summary = ''
            try {
              const r = calculateSession(sessionToInput(s), { asOf: new Date().toISOString() })
              summary =
                s.status === 'completed'
                  ? `利益 ${formatYen(r.operatingProfitYen)}・${r.hourlyYen === null ? '時給 算出不可' : `${formatYen(r.hourlyYen)}/時`}`
                  : `売上 ${formatYen(r.revenueYen)}（未確定）`
              if (r.errors.length && s.status === 'completed') summary += '・⚠️ 要確認'
            } catch {
              summary = '⚠️ 入力に誤りがあります'
            }
            return (
              <li key={s.id}>
                <button type="button" className="list-item" onClick={() => onEdit(s.id)}>
                  <span className="list-title">
                    {formatDateTime(s.departedAt)} <span className="tag">{STATUS_LABELS[s.status]}</span>
                  </span>
                  <span className="hint">
                    {PLATFORM_LABELS[s.platform]}
                    {s.weather && `・${WEATHER_LABELS[s.weather]}`}
                    {s.note === 'デモ用の合成データ' && '・デモ'}
                  </span>
                  <span>{summary}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
