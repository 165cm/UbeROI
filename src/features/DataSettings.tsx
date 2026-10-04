// データ管理（S07）：デモ切り替え・バックアップの書き出し／復元・全削除
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Notice, Problems, errorMessages, localToday } from '../components/fields'
import { useData } from '../storage/context'
import { InstallHelp } from './InstallHelp'
import {
  TABLE_LABELS,
  backupFileName,
  createBackup,
  deleteAllData,
  markBackedUp,
  parseBackup,
  restoreBackup,
  type Backup,
} from '../storage/backup'

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function DataSettings() {
  const { db, mode, setMode } = useData()
  const settings = useLiveQuery(() => db.settings.get('settings'), [db])
  const [problems, setProblems] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<{ fileName: string; backup: Backup; counts: Record<string, number> } | null>(null)
  const [busy, setBusy] = useState(false)

  const exportJson = async () => {
    setProblems([])
    try {
      const backup = await createBackup(db, mode)
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = backupFileName(mode, localToday())
      a.click()
      URL.revokeObjectURL(url)
      await markBackedUp(db)
      setNotice('⬇️ ファイルを作りました。ダウンロードの一覧で保存されたか確かめてください')
    } catch (e) {
      // 失敗した時は成功の表示を出さず、もう一度試せるようにする
      setProblems(errorMessages(e))
    }
  }

  const pickFile = async (file: File | undefined) => {
    setProblems([])
    setPending(null)
    if (!file) return
    if (file.size > 20 * 1024 * 1024) {
      setProblems(['ファイルが大きすぎます（20MBまで）'])
      return
    }
    const result = parseBackup(await file.text())
    if (!result.ok) {
      setProblems(['このファイルでは復元できません。今のデータはそのままです。', ...result.problems])
      return
    }
    setPending({ fileName: file.name, backup: result.backup, counts: result.counts })
  }

  const restore = async () => {
    if (!pending) return
    setBusy(true)
    try {
      await restoreBackup(db, pending.backup)
      setPending(null)
      setNotice('✅ 復元しました')
    } catch (e) {
      setProblems(['復元できませんでした。今のデータはそのままです。', ...errorMessages(e)])
    } finally {
      setBusy(false)
    }
  }

  const deleteAll = async () => {
    const label = mode === 'demo' ? 'デモのデータ' : '自分の実績（記録・設定・装備のすべて）'
    if (!window.confirm(`${label}をすべて削除します。元に戻せません。先にバックアップを書き出しましたか？`)) return
    if (!window.confirm('本当に削除しますか？')) return
    try {
      await deleteAllData(db)
      setNotice('🗑️ すべて削除し、初期状態に戻しました')
    } catch (e) {
      setProblems(errorMessages(e))
    }
  }

  return (
    <div className="stack">
      <InstallHelp />
      <section className="card stack">
        <h3>🧪 表示するデータ</h3>
        <p className="hint">デモは合成データで、実績とは別の場所に保存されます。切り替えても実績は消えません。</p>
        <div className="segmented" role="radiogroup" aria-label="表示するデータ">
          <button type="button" role="radio" aria-checked={mode === 'real'} onClick={() => setMode('real')}>📒 自分の実績</button>
          <button type="button" role="radio" aria-checked={mode === 'demo'} onClick={() => setMode('demo')}>🧪 デモ</button>
        </div>
      </section>

      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}

      <section className="card stack">
        <h3>💾 バックアップ</h3>
        <p>
          最後のバックアップ：<strong>{settings?.lastBackupAt ? formatDateTime(settings.lastBackupAt) : 'まだありません'}</strong>
        </p>
        <p className="hint">データはこの端末のブラウザーの中だけにあります（外部へは送りません。暗号化はしていません）。機種変更やブラウザーのデータ削除で消えるので、ときどき書き出して、クラウドやパソコンにも保存してください。</p>
        <button type="button" className="primary" onClick={() => void exportJson()}>⬇️ バックアップを書き出す</button>
      </section>

      <section className="card stack">
        <h3>♻️ バックアップから復元</h3>
        <p className="hint">今の{mode === 'demo' ? 'デモの' : ''}データを、選んだファイルの内容で<strong>すべて置き換えます</strong>（足し合わせはしません）。読み込む前に中身を確かめます。</p>
        <label className="field">
          <span>バックアップのファイル（.json）</span>
          <input type="file" accept="application/json,.json" onChange={(e) => void pickFile(e.target.files?.[0])} />
        </label>
        {pending && (
          <div className="subcard stack" aria-live="polite">
            <strong>📄 {pending.fileName}</strong>
            <p className="hint">書き出した日時：{formatDateTime(pending.backup.exported_at)}</p>
            {pending.backup.mode !== mode && (
              <p className="problems">⚠️ このファイルは{pending.backup.mode === 'demo' ? 'デモ' : '実績'}のバックアップです。今は{mode === 'demo' ? 'デモ' : '実績'}を表示中なので、こちらに入ります。</p>
            )}
            <ul>
              {Object.entries(pending.counts).map(([table, count]) => (
                <li key={table}>{TABLE_LABELS[table as keyof typeof TABLE_LABELS]}：{count}件</li>
              ))}
            </ul>
            <button type="button" className="primary" disabled={busy} onClick={() => void restore()}>
              {busy ? '復元中…' : '♻️ この内容で置き換える'}
            </button>
            <button type="button" disabled={busy} onClick={() => setPending(null)}>やめる</button>
          </div>
        )}
      </section>

      <Problems items={problems} />

      <section className="card stack">
        <h3>🗑️ すべて削除</h3>
        <p className="hint">{mode === 'demo' ? 'デモのデータ' : '自分の実績'}をすべて消して、初期状態に戻します。元に戻せないので、先にバックアップを書き出してください。</p>
        <button type="button" className="danger" onClick={() => void deleteAll()}>🗑️ すべて削除する</button>
      </section>
    </div>
  )
}
