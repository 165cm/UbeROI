// 設定 → 基本：🕒 働ける時間。曜日ごとの時間帯（日本時間）。プリセットから選んで、曜日ごとに直せる。
// 計画のおすすめ・クエストのための時間・作戦は、この中だけで組む（未設定は制限なし）
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AVAILABILITY_MAX_RANGES, AVAILABILITY_PRESETS, weeklyAvailableHours, type WeeklyAvailability } from '../domain'
import { CardTitle, Notice, Problems, errorMessages } from '../components/fields'
import { useData } from '../storage/context'
import { saveSettings } from '../storage/repo'

/** 月曜から並べる */
const ORDER = [1, 2, 3, 4, 5, 6, 0] as const
const DAY = ['日', '月', '火', '水', '木', '金', '土'] as const
const dayText = (ranges: { start: string; end: string }[]) => (ranges.length === 0 ? '働かない' : ranges.map((r) => `${r.start}〜${r.end}`).join('・'))

export function AvailabilitySettings() {
  const { db } = useData()
  const saved = useLiveQuery(() => db.settings.get('settings'), [db])
  const [form, setForm] = useState<WeeklyAvailability | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  if (!saved) return null
  const current = saved.availability ?? null

  const save = async (av: WeeklyAvailability | null) => {
    try {
      await saveSettings(db, { availability: av })
      setProblems([])
      setForm(null)
      setNotice(av ? `💾 働ける時間を保存しました（1週間 ${weeklyAvailableHours(av)}時間）` : '💾 制限なし（いつでも）にしました')
    } catch (e) {
      setProblems(errorMessages(e))
    }
  }

  const title = (
    <CardTitle
      id="availability-title"
      tip="計画の「💡 空いている、稼げそうな時間」「🎯 クエストのための時間」「🧭 クエスト作戦」は、この時間の中だけで組みます。プリセットを選んでから、曜日ごとに直せます。終了が開始より前（例：19:00〜02:00）は翌日までです。未設定は制限なし（いつでも）です"
      right={
        !form && (
          <button type="button" className="icon" aria-label="働ける時間を編集" onClick={() => setForm(current ?? AVAILABILITY_PRESETS[0]!.days)}>
            ✏️
          </button>
        )
      }
    >
      🕒 働ける時間
    </CardTitle>
  )

  if (!form) {
    return (
      <section className="card stack" aria-labelledby="availability-title">
        {title}
        {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
        {current ? (
          <dl className="stats availability-summary">
            {ORDER.map((d) => (
              <div key={d}>
                <dt>{DAY[d]}</dt>
                <dd>{dayText(current[d] ?? [])}</dd>
              </div>
            ))}
            <div className="wide">
              <dt>1週間</dt>
              <dd>{weeklyAvailableHours(current)}時間</dd>
            </div>
          </dl>
        ) : (
          <p className="hint">制限なし（いつでも）。✏️ で「平日は夜だけ」「午前だけ」などを選べます</p>
        )}
      </section>
    )
  }

  const setDay = (d: number, ranges: { start: string; end: string }[]) => setForm(form.map((x, i) => (i === d ? ranges : x)))
  return (
    <section className="card stack" aria-labelledby="availability-title">
      {title}
      <div className="buttons" role="group" aria-label="働ける時間のプリセット">
        {AVAILABILITY_PRESETS.map((p) => (
          <button key={p.key} type="button" onClick={() => setForm(p.days.map((x) => x.map((r) => ({ ...r }))))} title={p.note}>
            {p.label}
          </button>
        ))}
      </div>
      <ul className="list availability-days" aria-label="曜日ごとの働ける時間">
        {ORDER.map((d) => {
          const ranges = form[d] ?? []
          return (
            <li key={d} className="line wrap">
              <strong className="availability-day">{DAY[d]}</strong>
              {ranges.length === 0 && <span className="hint grow">働かない</span>}
              {ranges.map((r, i) => (
                <span key={i} className="line availability-range">
                  <input
                    type="time"
                    aria-label={`${DAY[d]}曜 ${i + 1}つ目の開始`}
                    value={r.start}
                    onChange={(e) => e.target.value && setDay(d, ranges.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                  />
                  〜
                  <input
                    type="time"
                    aria-label={`${DAY[d]}曜 ${i + 1}つ目の終了`}
                    value={r.end}
                    onChange={(e) => e.target.value && setDay(d, ranges.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                  />
                  <button type="button" className="icon danger-text" aria-label={`${DAY[d]}曜 ${i + 1}つ目を外す`} onClick={() => setDay(d, ranges.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </span>
              ))}
              {ranges.length < AVAILABILITY_MAX_RANGES && (
                <button type="button" className="icon" aria-label={`${DAY[d]}曜に時間帯を足す`} onClick={() => setDay(d, [...ranges, { start: '18:00', end: '22:00' }])}>
                  ＋
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <p className="hint">1週間 {weeklyAvailableHours(form)}時間</p>
      <Problems items={problems} />
      <div className="actions">
        <button type="button" className="primary" onClick={() => void save(form)}>
          💾 保存
        </button>
        <button type="button" onClick={() => void save(null)}>制限なしにする</button>
        <button type="button" onClick={() => (setForm(null), setProblems([]))}>やめる</button>
      </div>
    </section>
  )
}
