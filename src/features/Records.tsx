import { serviceLabel } from '../storage/services'
// 記録の一覧と編集・削除（削除は確認と直後の取り消しつき）
import { useCallback, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { calculateSession } from '../domain'
import { Notice } from '../components/fields'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { deleteSession, emptySession, restoreSession } from '../storage/repo'
import { WEATHER_LABELS, type SessionRecord } from '../storage/schema'
import { sessionToInput } from '../storage/toDomain'
import { SessionForm } from './SessionForm'

const STATUS_LABELS: Record<SessionRecord['status'], string> = {
  active: '🟢 稼働中',
  draft: '📝 下書き',
  completed: '✅ 確定',
}

/** 出発が今日（端末の日付）か */
function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString()
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

export function Records({ editId, onEdit }: { editId: string | null; onEdit: (id: string | null) => void }) {
  const { db } = useData()
  const sessions = useLiveQuery(() => db.sessions.orderBy('departedAt').reverse().toArray(), [db])
  const [filter, setFilter] = useState<'all' | 'draft'>('all')
  const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null)
  const [creating, setCreating] = useState<SessionRecord | null>(null)
  const closeNotice = useCallback(() => setNotice(null), [])

  if (!sessions) return <p className="loading">読み込み中…</p>

  const editing = creating ?? (editId ? sessions.find((s) => s.id === editId) : undefined)
  if (editing) {
    return (
      <div className="stack">
        <div className="settle-head">
          <button type="button" className="icon back-button" aria-label="一覧に戻る" onClick={() => (setCreating(null), onEdit(null))}>
            ←
          </button>
          <div className="settle-title">
            <h3>{creating ? '記録を追加' : editing.status === 'completed' ? '記録の編集' : isToday(editing.departedAt) ? '今日の精算' : '精算'}</h3>
            <span className="hint">{creating ? '過去の稼働' : formatDateTime(editing.departedAt)}</span>
          </div>
        </div>
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
      <div className="segmented wrap" role="group" aria-label="記録の絞り込み">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>すべて</button>
        <button type="button" aria-pressed={filter === 'draft'} onClick={() => setFilter('draft')}>未精算・下書き（{sessions.filter((s) => s.status === 'draft').length}）</button>
      </div>
      {filter === 'draft' && !sessions.some((s) => s.status === 'draft') && <p className="card">未精算・下書きはありません。</p>}
      {sessions.length === 0 ? (
        <p className="card hint">まだ記録がありません。ホームの「出発」か、上のボタンから入力します。</p>
      ) : (
        <ul className="list">
          {sessions.filter((s) => filter === 'all' || s.status === 'draft').map((s) => {
            let main = ''
            let sub = ''
            try {
              const r = calculateSession(sessionToInput(s), { asOf: new Date().toISOString() })
              main = s.status === 'completed' ? formatYen(r.operatingProfitYen) : `売上 ${formatYen(r.revenueYen)}`
              sub = s.status === 'completed' ? (r.hourlyYen === null ? '時給 算出不可' : `${formatYen(r.hourlyYen)}/時`) : '未確定'
              if (r.errors.length && s.status === 'completed') sub += '・⚠️ 要確認'
            } catch {
              main = '⚠️ 入力に誤り'
            }
            const meta = [serviceLabel(s), s.weather && WEATHER_LABELS[s.weather], s.areaLabel, s.note === 'デモ用の合成データ' && 'デモ'].filter(Boolean).join('・')
            return (
              <li key={s.id}>
                <button type="button" className="list-item record-item" onClick={() => onEdit(s.id)}>
                  <span className="line">
                    <span className="grow list-title">{formatDateTime(s.departedAt)}</span>
                    <span className="num">{main}</span>
                  </span>
                  <span className="line hint">
                    <span className="grow">
                      <span className="tag">{STATUS_LABELS[s.status]}</span> {meta}
                    </span>
                    <span>{sub}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
