// 🏆 リーダーボード（クエストに付ける）：順位と件数だけを入れ（スクショから読み取れる）、上との差と攻める目標を出す。
// 他の人の名前・顔写真は読まない・保存しない。計算は src/domain/leaderboard.ts（§5.13）
import { useState } from 'react'
import { addSnapshot, leaderboardOutlook, parseLeaderboardText, type LeaderboardPrize, type LeaderboardRow } from '../domain'
import { DateTimeInput, IntInput, Problems, errorMessages } from '../components/fields'
import { formatYen } from '../format'
import type { QuestRecord } from '../storage/schema'
import { recognizeImages } from './ocr'

type Board = NonNullable<QuestRecord['leaderboard']>

const fmtAt = (iso: string) => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
const METHOD_TEXT = { pace: '撮った2回の間のペースから', ratio: '期間の経った割合から', now: 'まだ始まったばかりなので今の件数のまま' } as const

/** クエストの回ごとの、リーダーボードのまとめ（上との差・攻める目標） */
export function LeaderboardSummary({ board, occ, countNow }: { board: Board; occ: { startsAt: string; endsAt: string }; countNow: number }) {
  const o = leaderboardOutlook({ ...board, startsAt: occ.startsAt, endsAt: occ.endsAt, myCountNow: countNow })
  if (!o) return null
  return (
    <div className="stack leaderboard" role="group" aria-label="リーダーボード">
      <p className="line">
        <span className="grow">
          🏆 {o.myRank !== null ? <strong>{o.myRank}位</strong> : '順位なし'}
          {o.myCount !== null && `・${o.myCount}件`}
        </span>
        <span className="hint">{fmtAt(o.at)}時点</span>
      </p>
      {o.above.length > 0 && <p className="hint">上との差：{o.above.map((a) => `${a.rank}位 ${a.gap === 0 ? '並ぶ' : `あと${a.gap}件`}`).join('・')}</p>}
      {o.target && (
        <p>
          🔥 攻める：<strong>{o.target.rank}位</strong>なら終了までに<strong>{o.target.need}件</strong>
          {o.target.more !== null && `（あと${o.target.more}件）`}
          {o.target.prizeYen > 0 && `・賞金${formatYen(o.target.prizeYen)}`}
          <span className="hint">（ほかの人の件数は{METHOD_TEXT[o.target.projection.method]}見込み）</span>
        </p>
      )}
    </div>
  )
}

/** リーダーボードを入れる（撮った時点を1つ足す）。賞金・狙う順位は回をまたいで残す */
export function LeaderboardForm({ quest, onSave, onCancel }: { quest: QuestRecord; onSave: (board: Board) => Promise<void>; onCancel: () => void }) {
  const prev = quest.leaderboard
  const [at, setAt] = useState<string>(() => new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString())
  const [myRank, setMyRank] = useState<number | null>(null)
  const [myCount, setMyCount] = useState<number | null>(null)
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [prizes, setPrizes] = useState<LeaderboardPrize[]>(prev?.prizes ?? [])
  const [targetRank, setTargetRank] = useState<number | null>(prev?.targetRank ?? null)
  const [problems, setProblems] = useState<string[]>([])
  const [reading, setReading] = useState<{ busy: boolean; message: string } | null>(null)

  const readShots = async (files: File[]) => {
    if (files.length === 0) return
    setReading({ busy: true, message: `📷 ${files.length}枚を読み取り中…（初めての時は読み取りの準備に少しかかります）` })
    try {
      const r = parseLeaderboardText(await recognizeImages(files))
      if (r.rows.length) setRows(r.rows)
      if (r.me) {
        setMyRank(r.me.rank)
        setMyCount(r.me.count)
      }
      if (r.prizes.length) setPrizes(r.prizes)
      const miss = r.missing.map((m) => ({ rows: '順位と件数', me: '自分の順位' })[m])
      setReading({
        busy: false,
        message:
          r.rows.length === 0
            ? '⚠️ 順位と件数を読み取れませんでした。手で入れてください'
            : `📷 ${r.rows.length}つの順位を読み取りました${r.prizes.length ? `・賞金${r.prizes.length}つ` : ''}。${miss.length ? `${miss.join('・')}は読み取れなかったので、手で入れてください。` : ''}確かめてから保存してください`,
      })
    } catch {
      setReading({ busy: false, message: '⚠️ 読み取れませんでした。初めて使う時は、電波のある所で試してください' })
    }
  }

  return (
    <form
      className="stack"
      aria-label={`${quest.label}のリーダーボード`}
      onSubmit={async (e) => {
        e.preventDefault()
        if (rows.length === 0 && myRank === null) {
          setProblems(['順位と件数を1つ以上入れてください（スクショから読み取れます）'])
          return
        }
        // 自分の行も順位の一覧に入れる（差と見込みに使う）
        const all = myRank !== null && myCount !== null && !rows.some((r) => r.rank === myRank) ? [...rows, { rank: myRank, count: myCount }] : rows
        const snapshot = { at, myRank, myCount, rows: [...all].sort((a, b) => a.rank - b.rank) }
        try {
          await onSave({ snapshots: addSnapshot(prev?.snapshots ?? [], snapshot), prizes: [...prizes].sort((a, b) => a.upToRank - b.upToRank), targetRank })
        } catch (err) {
          setProblems(errorMessages(err))
        }
      }}
    >
      <strong>🏆 リーダーボード</strong>
      <div className="stack">
        <label className="button-link">
          📷 スクショから読み取る
          <input
            type="file"
            accept="image/*"
            multiple
            className="visually-hidden"
            disabled={reading?.busy}
            aria-describedby="board-shot-tip"
            onChange={(e) => {
              void readShots([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </label>
        <p id="board-shot-tip" className="hint">
          配達アプリのリーダーボードの画面。順位と件数だけを読み、ほかの人の名前・写真は読み捨てます（保存・送信しません）。配達中の画面は撮らないでください
        </p>
        {reading && <p role="status">{reading.message}</p>}
      </div>
      <DateTimeInput label="画面を見た時刻" value={at} onChange={(v) => v && setAt(v)} />
      <div className="row">
        <IntInput label="自分の順位" unit="位" value={myRank} onChange={setMyRank} />
        <IntInput label="自分の件数" unit="件" value={myCount} onChange={setMyCount} />
      </div>
      {rows.map((r, i) => (
        <div key={i} className="row">
          <IntInput label={`${i + 1}行目の順位`} unit="位" value={r.rank} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, rank: v ?? 0 } : x)))} />
          <IntInput label="件数" unit="件" value={r.count} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, count: v ?? 0 } : x)))} />
          <button type="button" className="danger-text" aria-label={`${i + 1}行目を外す`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setRows([...rows, { rank: (rows[rows.length - 1]?.rank ?? 0) + 1, count: rows[rows.length - 1]?.count ?? 0 }])}>
        ＋ 順位を追加
      </button>
      {prizes.map((p, i) => (
        <div key={i} className="row">
          <IntInput label={`賞金${i + 1}：何位まで`} unit="位" value={p.upToRank} onChange={(v) => setPrizes(prizes.map((x, j) => (j === i ? { ...x, upToRank: v ?? 0 } : x)))} />
          <IntInput label="賞金" unit="円" value={p.rewardYen} onChange={(v) => setPrizes(prizes.map((x, j) => (j === i ? { ...x, rewardYen: v ?? 0 } : x)))} />
          <button type="button" className="danger-text" aria-label={`賞金${i + 1}を外す`} onClick={() => setPrizes(prizes.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setPrizes([...prizes, { upToRank: (prizes[prizes.length - 1]?.upToRank ?? 0) + 1, rewardYen: 0 }])}>
        ＋ 賞金を追加
      </button>
      <IntInput
        label="狙う順位"
        unit="位"
        value={targetRank}
        onChange={setTargetRank}
        placeholder="自動"
        tip="空欄なら、賞金のある一番下の順位（そこより下にいる時）か、1つ上の順位を狙います。計画の「今週の作戦」に「攻める」の選択肢が出ます"
      />
      <Problems items={problems} />
      <div className="actions">
        <button type="submit" className="primary">💾 保存</button>
        <button type="button" onClick={onCancel}>やめる</button>
      </div>
    </form>
  )
}
