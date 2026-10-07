// ホームの「🎯 クエスト」：今の期間のクエストの進み具合（見込みの管理用。実績の売上には自動で入れない）
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { QUEST_REPEAT_LABELS, parseQuestText, questOccurrencesNow, questProgress, selectiveQuestPeriod, type Platform, type QuestRepeat } from '../domain'
import { CardTitle, DateTimeInput, IntInput, Notice, Problems, Select, TextInput, errorMessages, localToday } from '../components/fields'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { newId, saveQuest } from '../storage/repo'
import { PLATFORM_LABELS, type QuestRecord } from '../storage/schema'
import { LeaderboardForm, LeaderboardSummary } from './Leaderboard'
import { recognizeImages } from './ocr'

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
  // 編集するクエストと、件数の調整を入れる回（くり返すクエストは回ごとに調整を持つ）
  const [editing, setEditing] = useState<{ quest: QuestRecord; index: number } | null>(null)
  const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null)
  // リーダーボードを入れているクエスト
  const [boardFor, setBoardFor] = useState<string | null>(null)
  if (!data) return null

  const nowMs = Date.parse(now)
  // 今の期間のもの・これから始まるもの（入力の誤りを直せるように）・終わってから1日以内のもの（達成分の入れ忘れ防止）を出す
  // くり返すクエストは、今の回（なければ次の回）と、終わって1日以内の前の回を出す
  const visible = data.quests
    .flatMap((q) => {
      const occ = questOccurrencesNow(q, now)
      const items = [...(occ.previous ? [{ quest: q, occ: occ.previous }] : []), { quest: q, occ: occ.current }]
      return items.filter(({ occ: o }) => nowMs < Date.parse(o.endsAt) + 86_400_000)
    })
    .sort((a, b) => a.occ.startsAt.localeCompare(b.occ.startsAt) || a.occ.endsAt.localeCompare(b.occ.endsAt))

  return (
    <section className="card stack" aria-labelledby="quest-title">
      <CardTitle
        id="quest-title"
        tip="配達アプリで選んだクエストの段階を入れると、期間内に帰宅した確定記録の件数から「あと何件で次の段階か」を出します。達成分は見込みなので、報酬が確定したら精算の「確定ボーナス」に入れてください。"
        right={
          !editing && (
            <button type="button" className="icon" aria-label="クエストを追加" onClick={() => setEditing({ quest: blankQuest(now), index: 0 })}>
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
          initial={editing.quest}
          index={editing.index}
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
          {visible.map(({ quest: q, occ }) => {
            const repeat = q.repeat ?? 'none'
            const offset = occ.index === 0 ? q.manualOffset : (q.offsets?.[String(occ.index)] ?? 0)
            const p = questProgress(
              { ...q, startsAt: occ.startsAt, endsAt: occ.endsAt, manualOffset: offset },
              data.sessions.map((s) => ({ status: s.status, returnedAt: s.returnedAt, completedCount: s.completedCount, eligible: s.platform === q.platform })),
              now,
            )
            const target = p.next ? p.count + p.next.remaining : q.tiers[q.tiers.length - 1]?.count ?? p.count
            const upcoming = nowMs < Date.parse(occ.startsAt)
            return (
              <div key={`${q.id}-${occ.index}`} className="subcard">
                <div className="line">
                  <strong className="grow">
                    {q.label}
                    {repeat !== 'none' && <span className="hint"> 🔁 {QUEST_REPEAT_LABELS[repeat]}</span>}
                  </strong>
                  <span className="tag">{p.ended ? '⌛ 終了' : upcoming ? '🕒 これから' : PLATFORM_LABELS[q.platform]}</span>
                  <button type="button" className="icon" aria-label={`${q.label}のリーダーボードを入れる`} aria-expanded={boardFor === q.id} onClick={() => setBoardFor(boardFor === q.id ? null : q.id)}>🏆</button>
                  <button type="button" className="icon" aria-label={`${q.label}を編集・件数の調整`} onClick={() => setEditing({ quest: q, index: occ.index })}>✏️</button>
                  <button
                    type="button"
                    className="icon danger-text"
                    aria-label={`${q.label}を削除${repeat !== 'none' ? '（くり返しもすべて）' : ''}`}
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
                  <span className="hint">{periodText(occ)}</span>
                </p>
                {p.unknownCountSessions > 0 && <p className="hint">⚠️ 件数未入力の記録{p.unknownCountSessions}件は数えていません</p>}
                {q.leaderboard && <LeaderboardSummary board={q.leaderboard} occ={occ} countNow={p.count} />}
                {boardFor === q.id && (
                  <LeaderboardForm
                    quest={q}
                    onCancel={() => setBoardFor(null)}
                    onSave={async (board) => {
                      await saveQuest(db, { ...q, leaderboard: board })
                      setBoardFor(null)
                      setNotice({ message: '🏆 リーダーボードを保存しました', undo: () => void db.quests.put(q).then(() => setNotice(null)) })
                    }}
                  />
                )}
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}

function QuestForm({ initial, index, onSave, onCancel }: { initial: QuestRecord; index: number; onSave: (q: QuestRecord) => Promise<void>; onCancel: () => void }) {
  const [q, setQ] = useState(initial)
  const [problems, setProblems] = useState<string[]>([])
  const [reading, setReading] = useState<{ busy: boolean; message: string } | null>(null)
  const today = localToday()

  /** 配達アプリの「クエストの進捗」の画面のスクショから、期間と段階を入力欄に入れる（保存は利用者が確かめてから） */
  const readShots = async (files: File[]) => {
    if (files.length === 0) return
    setReading({ busy: true, message: `📷 ${files.length}枚を読み取り中…（初めての時は読み取りの準備に少しかかります）` })
    try {
      const r = parseQuestText(await recognizeImages(files), new Date().toISOString())
      const next = { ...q }
      if (r.startsAt) next.startsAt = r.startsAt
      if (r.endsAt) next.endsAt = r.endsAt
      // 段階を読めた時だけ置き換える（読めた額は段階ごとの上乗せ。読めなかった時は今の書き方のまま）
      if (r.tiers.length > 0) {
        next.tiers = r.tiers
        next.rewardMode = 'incremental'
      }
      const days = r.startsAt && r.endsAt ? (Date.parse(r.endsAt) - Date.parse(r.startsAt)) / 86_400_000 : null
      // 名前は、新しいクエストで既定の名前のままの時（または空欄の時）だけ入れる。保存済みの名前は変えない
      const isNew = !initial.createdAt
      if (r.startsAt && ((isNew && q.label === initial.label) || !q.label.trim())) next.label = days !== null && days >= 1 ? '日跨ぎクエスト' : 'ピークタイムクエスト'
      setQ(next)
      const fmt = (iso: string) => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
      const got = [
        r.startsAt && `開始 ${fmt(r.startsAt)}`,
        r.endsAt && `終了 ${fmt(r.endsAt)}`,
        r.tiers.length > 0 && `段階${r.tiers.length}つ（最後は${r.tiers[r.tiers.length - 1]!.count}件）`,
      ].filter(Boolean)
      const miss = r.missing.map((m) => ({ start: '開始', end: '終了の時刻', tiers: '段階' })[m])
      setReading({
        busy: false,
        message:
          got.length === 0
            ? '⚠️ クエストの期間や段階を読み取れませんでした。手で入れてください'
            : `📷 読み取りました：${got.join('・')}。${miss.length ? `${miss.join('・')}は読み取れなかったので、手で入れてください。` : ''}確かめてから保存してください`,
      })
    } catch {
      setReading({ busy: false, message: '⚠️ 読み取れませんでした。初めて使う時は、電波のある所で試してください' })
    }
  }
  // 調整を入れる回：くり返さないクエストは常に最初の回（manualOffset）
  const slot = (q.repeat ?? 'none') === 'none' ? 0 : index
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
      <div className="stack">
        <label className="button-link">
          📷 スクショから読み取る
          <input
            type="file"
            accept="image/*"
            multiple
            className="visually-hidden"
            disabled={reading?.busy}
            aria-describedby="quest-shot-tip"
            onChange={(e) => {
              void readShots([...(e.target.files ?? [])])
              e.target.value = ''
            }}
          />
        </label>
        <p id="quest-shot-tip" className="hint">
          配達アプリの「クエストの進捗」の画面（1つのクエストを2枚に分けてもよい）。配達中の画面は撮らないでください。画像は端末の中で読むだけで、保存・送信しません
        </p>
        {reading && <p role="status">{reading.message}</p>}
      </div>
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
        <button type="button" onClick={() => setQ({ ...q, ...weeklyHalf('weekday'), repeat: 'weekly' })}>🔁 毎週の平日（月4:00〜金4:00）</button>
        <button type="button" onClick={() => setQ({ ...q, ...weeklyHalf('weekend'), repeat: 'weekly' })}>🔁 毎週の週末（金4:00〜月4:00）</button>
        <button type="button" onClick={() => peak('10:30', '15:00', '今日のランチピーク')}>今日のランチ</button>
        <button type="button" onClick={() => peak('17:00', '21:30', '今日のディナーピーク')}>今日のディナー</button>
      </div>
      <div className="row">
        <DateTimeInput label="開始" value={q.startsAt} onChange={(v) => v && setQ({ ...q, startsAt: v })} />
        <DateTimeInput label="終了" value={q.endsAt} onChange={(v) => v && setQ({ ...q, endsAt: v })} />
      </div>
      <Select
        label="くり返し"
        value={q.repeat ?? 'none'}
        options={(Object.keys(QUEST_REPEAT_LABELS) as QuestRepeat[]).map((r) => ({ value: r, label: QUEST_REPEAT_LABELS[r] }))}
        onChange={(v) => setQ({ ...q, repeat: v })}
        tip="開始〜終了を最初の回として、同じ長さで毎日・毎週・毎月くり返します。一度登録すれば、次の回からは登録し直さなくてよくなります。件数は回ごとに数えます"
      />
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
        label={(q.repeat ?? 'none') === 'none' ? '件数の調整（±）' : 'この回の件数の調整（±）'}
        unit="件"
        allowNegative
        value={slot === 0 ? q.manualOffset : (q.offsets?.[String(slot)] ?? 0)}
        onChange={(v) => (slot === 0 ? setQ({ ...q, manualOffset: v ?? 0 }) : setQ({ ...q, offsets: { ...q.offsets, [String(slot)]: v ?? 0 } }))}
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

/** 毎週の平日（月曜4:00〜金曜4:00）・週末（金曜4:00〜月曜4:00）の、今か次の回 */
function weeklyHalf(half: 'weekday' | 'weekend'): { startsAt: string; endsAt: string } {
  const p = selectiveQuestPeriod(new Date().toISOString())
  const isWeekday = p.label.startsWith('平日')
  if ((half === 'weekday') === isWeekday) return { startsAt: p.startsAt, endsAt: p.endsAt }
  // 今はもう片方の期間なので、その終わりから始まる期間（＝次の回）
  return { startsAt: p.endsAt, endsAt: selectiveQuestPeriod(p.endsAt).endsAt }
}
