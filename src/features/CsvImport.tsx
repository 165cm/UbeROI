// CSVから記録を取り込む（P1）：読み込み → 確認（追加・取込済み・問題）→ まとめて確定。問題があれば1件も保存しない
import { useState } from 'react'
import { calculateSession, type Platform } from '../domain'
import { CardTitle, Notice, Problems, Select, errorMessages } from '../components/fields'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { CSV_V1_SAMPLE, commitCsvImport, previewCsvImport, type ImportPreview } from '../storage/csvImport'
import { PLATFORM_LABELS } from '../storage/schema'
import { sessionToInput } from '../storage/toDomain'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const SHOWN_ROWS = 20

function formatSpan(departedAt: string, returnedAt: string | null): string {
  const d = new Date(departedAt)
  const time = (x: Date) => x.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  const date = d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
  return `${date} ${time(d)}〜${returnedAt ? time(new Date(returnedAt)) : ''}`
}

export function CsvImport() {
  const { db, mode } = useData()
  const [platform, setPlatform] = useState<Platform>('uber')
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 同じファイルをもう一度選べるよう、確定・やめる時にファイル欄を作り直す
  const [inputKey, setInputKey] = useState(0)
  const clear = () => {
    setFile(null)
    setPreview(null)
    setInputKey((k) => k + 1)
  }

  const check = async (next: { name: string; text: string } | null, p: Platform) => {
    setPreview(next ? previewCsvImport(next.text, await db.sessions.toArray(), p) : null)
  }

  const pickFile = async (f: File | undefined) => {
    setProblems([])
    setNotice(null)
    setFile(null)
    setPreview(null)
    if (!f) return
    if (f.size > MAX_FILE_BYTES) {
      setProblems(['ファイルが大きすぎます（5MBまで）。ファイルを分けてください'])
      return
    }
    const next = { name: f.name, text: await f.text() }
    setFile(next)
    await check(next, platform)
  }

  const commit = async () => {
    if (!file) return
    setBusy(true)
    setProblems([])
    try {
      const { added, skipped } = await commitCsvImport(db, file.text, platform)
      clear()
      setNotice(`✅ ${added}件を取り込みました${skipped ? `（取込済みの${skipped}件は飛ばしました）` : ''}`)
    } catch (e) {
      setProblems(['取り込めませんでした。記録は何も変わっていません。', ...errorMessages(e)])
      await check(file, platform)
    } finally {
      setBusy(false)
    }
  }

  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob(['﻿', CSV_V1_SAMPLE], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'deli-kan-import-sample.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const newRows = preview?.rows.filter((r) => r.status === 'new') ?? []

  return (
    <section className="card stack" aria-labelledby="csv-import-title">
      <CardTitle
        id="csv-import-title"
        tip={
          <>
            ほかのアプリや表計算ソフトで付けていた記録を、まとめて{mode === 'demo' ? 'デモに' : '自分の実績に'}追加します（1行＝1回の稼働）。見本と同じ見出しの列にして、「CSV UTF-8」形式で保存してください。日時は 2026-10-04T18:00:00+09:00 のように時差まで書きます。読み込む前に中身を確かめ、問題が1つでもあれば1件も保存しません。
          </>
        }
        right={
          <button type="button" className="icon" aria-label="見本のCSVをダウンロード" onClick={downloadSample}>
            ⬇️
          </button>
        }
      >
        📥 CSVから記録を取り込む
      </CardTitle>
      <Select
        label="どのサービスの記録か"
        value={platform}
        options={(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => ({ value: p, label: PLATFORM_LABELS[p] }))}
        onChange={(p) => {
          setPlatform(p)
          void check(file, p)
        }}
        tip="CSVに platform 列がある行は、その値を使います"
      />
      <label className="field">
        <span>CSVファイル（.csv）</span>
        <input key={inputKey} type="file" accept=".csv,text/csv" onChange={(e) => void pickFile(e.target.files?.[0])} />
      </label>
      {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
      <Problems items={problems} />
      {file && preview && (
        <div className="subcard stack" aria-live="polite">
          <strong>📄 {file.name}</strong>
          <ul>
            <li>追加{preview.problems.length ? 'できる' : 'する'}：{preview.counts.new}件</li>
            {preview.counts.duplicate > 0 && <li>取込済み（同じ内容なので飛ばす）：{preview.counts.duplicate}件</li>}
            {preview.counts.conflict > 0 && <li>取込済みで内容が違う（上書きしない）：{preview.counts.conflict}件</li>}
          </ul>
          {preview.warnings.map((w) => (
            <p key={w} className="hint">ℹ️ {w}</p>
          ))}
          {preview.problems.length > 0 ? (
            <Problems items={['この内容では取り込めません。CSVを直してから、もう一度選んでください（1件も保存していません）。', ...preview.problems]} />
          ) : newRows.length === 0 ? (
            <p>このファイルの記録は、すべて取込済みです。追加するものはありません。</p>
          ) : (
            <>
              <ul>
                {newRows.slice(0, SHOWN_ROWS).map(({ line, session: s }) => {
                  const result = calculateSession(sessionToInput(s))
                  return (
                    <li key={line}>
                      {formatSpan(s.departedAt, s.returnedAt)}　{s.completedCount}件　売上 {formatYen(result.revenueYen)}
                      {result.rentalYen ? `　レンタル ${formatYen(result.rentalYen)}` : ''}
                      {s.areaLabel && `　${s.areaLabel}`}
                    </li>
                  )
                })}
              </ul>
              {newRows.length > SHOWN_ROWS && <p className="hint">ほか{newRows.length - SHOWN_ROWS}件</p>}
            </>
          )}
          {preview.ok && (
            <button type="button" className="primary" disabled={busy} onClick={() => void commit()}>
              {busy ? '取り込み中…' : `📥 ${preview.counts.new}件を取り込む`}
            </button>
          )}
          <button type="button" disabled={busy} onClick={clear}>{preview.ok ? 'やめる' : '閉じる'}</button>
        </div>
      )}
    </section>
  )
}
