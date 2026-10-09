import { BusyScreenshotImport } from './BusyScreenshotImport'
import { areaDayDates, markAreaDays } from '../storage/areaVerification'
// 設定・エリア：配達アプリの「時間帯ごとの傾向」（曜日×1時間×4段階）を、エリアごとに見ながら写す
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BUSINESS_HOURS, emptyBusyness, filledCount, WEEKDAY_LABELS, type BusynessTable } from '../domain'
import { CardTitle, IntInput, Notice, Problems, TextInput, errorMessages, localToday } from '../components/fields'
import { useData } from '../storage/context'
import { deleteArea, newId, primaryArea, saveArea, saveSettings } from '../storage/repo'
import type { AreaRecord } from '../storage/schema'
import { MapPicker } from './AreaMap'

/** 配達アプリの表と同じ、月曜始まりの並び */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
const LEVEL_LABELS = ['未入力', '空き', 'やや空き', 'やや混む', '混む'] as const
/** 確かめてから何日たったら見直しを知らせるか */
export const AREA_REVIEW_DAYS = 30

export function daysSince(date: string, today = localToday()): number {
  return Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000)
}

function blankArea(): AreaRecord {
  return { id: newId(), name: '', levels: emptyBusyness(), towns: [], checkedAt: localToday(), createdAt: '', updatedAt: '', revision: 0 }
}

export function AreaSettings() {
  const { db } = useData()
  const data = useLiveQuery(async () => ({ areas: await db.areas.toArray(), settings: await db.settings.get('settings') }), [db])
  const [editing, setEditing] = useState<{ area: AreaRecord; primary: boolean } | null>(null)
  const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null)
  if (!data) return <p className="loading">読み込み中…</p>
  const primary = primaryArea(data.areas, data.settings)

  if (editing) {
    return (
      <AreaForm
        initial={editing.area}
        initialPrimary={editing.primary}
        primaryId={primary?.id ?? null}
        others={data.areas.filter((a) => a.id !== editing.area.id && a.center && a.radiusM).map((a) => ({ name: a.name, center: a.center!, radiusM: a.radiusM! }))}
        onCancel={() => setEditing(null)}
        onSave={async (area, makePrimary) => {
          // エリアと主なエリアの指定は、同じ1回の書き込みで保存する
          await saveArea(db, area, makePrimary)
          setEditing(null)
          setNotice({ message: '💾 エリアを保存しました' })
        }}
      />
    )
  }

  return (
    <div className="stack">
      {notice && <Notice message={notice.message} onUndo={notice.undo} onClose={() => setNotice(null)} />}
      <section className="card">
        <CardTitle
          tip="Uber Eats の配達アプリでエリアを押すと出る「時間帯ごとの傾向」（曜日ごと・1時間ごとの棒の濃さ）を、見ながら4段階で写します。計画と「続ける？帰る？」の売上の見込みに使います（主なエリア）。段階はそのエリアの中での比較で、時給そのものではありません。自分の記録が10回以上たまると、自分の平均を混み具合の比で補正します。混み具合は季節やキャンペーンで変わるので、1か月ごとに見直してください。"
          right={
            <button type="button" className="icon" aria-label="エリアを追加" onClick={() => setEditing({ area: blankArea(), primary: data.areas.length === 0 })}>
              ＋
            </button>
          }
        >
          📈 エリアの混み具合
        </CardTitle>
        {data.areas.length === 0 && <p className="hint">まだありません（＋で追加）</p>}
        <ul className="list">
          {data.areas.map((a) => {
            const age = daysSince(a.checkedAt)
            return (
              <li key={a.id} className="line">
                <span className="grow">
                  <strong>{a.name}</strong> {primary?.id === a.id && <span className="tag">主なエリア</span>}
                  <br />
                  <span className="hint">
                    {filledCount(a.levels)}/168マス・地名{a.towns.length}{a.moveMinutes && primary?.id !== a.id ? (a.moveFromAreaId === primary?.id ? `・移動${a.moveMinutes}分` : '・移動の分は入れ直し') : ''}・確認 {a.checkedAt}
                    {age >= AREA_REVIEW_DAYS && <strong>（⚠️ {age}日たちました。見直しましょう）</strong>}
                  </span>
                </span>
                <button type="button" className="icon" aria-label={`${a.name}を編集`} onClick={() => setEditing({ area: structuredClone(a), primary: primary?.id === a.id })}>
                  ✏️
                </button>
                <button
                  type="button"
                  className="icon danger-text"
                  aria-label={`${a.name}を削除`}
                  onClick={async () => {
                    const wasPrimary = data.settings?.primaryAreaId === a.id
                    const deleted = await deleteArea(db, a.id)
                    if (deleted) {
                      setNotice({
                        message: '🗑️ 削除しました',
                        undo: () =>
                          void db.areas
                            .put(deleted)
                            .then(() => (wasPrimary ? saveSettings(db, { primaryAreaId: deleted.id }) : undefined))
                            .then(() => setNotice(null)),
                      })
                    }
                  }}
                >
                  🗑️
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

function AreaForm({
  initial,
  initialPrimary,
  primaryId,
  others,
  onSave,
  onCancel,
}: {
  /** 地図に薄く出す、ほかのエリアの円 */
  others: { name: string; center: { lat: number; lng: number }; radiusM: number }[]
  initial: AreaRecord
  initialPrimary: boolean
  /** 今の主なエリア（移動の分をどこから測ったかとして保存する） */
  primaryId: string | null
  onSave: (area: AreaRecord, primary: boolean) => Promise<void>
  onCancel: () => void
}) {
  const [area, setArea] = useState(initial)
  const [primary, setPrimary] = useState(initialPrimary)
  const [day, setDay] = useState<number>(WEEK_ORDER[0])
  const [townsText, setTownsText] = useState(initial.towns.join('、'))
  const [problems, setProblems] = useState<string[]>([])
  // 地図は開いた時だけ作る（開かない時は地図の画像を読み込まない）
  const [mapOpen, setMapOpen] = useState(false)
  const [beforeImport, setBeforeImport] = useState<AreaRecord | null>(null)
  const row = area.levels[day]!

  const setLevels = (levels: BusynessTable) => setArea({ ...area, levels })
  const cycle = (hour: number) => setLevels(area.levels.map((d, i) => (i === day ? d.map((v, h) => (h === hour ? (v + 1) % 5 : v)) : d)))
  const copyFrom = (from: number) => setLevels(area.levels.map((d, i) => (i === day ? [...area.levels[from]!] : d)))
  const copyTo = (targets: readonly number[]) => setLevels(area.levels.map((d, i) => (targets.includes(i) && i !== day ? [...row] : d)))
  const previousDay = WEEK_ORDER[(WEEK_ORDER.indexOf(day as (typeof WEEK_ORDER)[number]) + 6) % 7]!

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          // 移動の分は「今の主なエリアから」として保存する（主なエリアにする時・主なエリアがない時は使わない）
          const from = !primary && area.moveMinutes != null && primaryId && primaryId !== area.id ? primaryId : null
          await onSave({ ...area, towns: townsText.split(/[、,，\n]/), moveMinutes: from ? area.moveMinutes : null, moveFromAreaId: from }, primary)
        } catch (err) {
          setProblems(errorMessages(err))
        }
      }}
    >
      <section className="card stack">
        <div className="row">
          <TextInput label="エリアの名前" value={area.name} onChange={(v) => setArea({ ...area, name: v })} placeholder="例：中野・荻窪エリア" />
          <label className="field">
            <span>配達アプリで確かめた日</span>
            <input type="date" value={area.checkedAt} onChange={(e) => {
              const date = e.target.value || localToday()
              setArea({ ...area, checkedAt: date, checkedByDay: area.checkedByDay ? area.levels.map(row => row.some(v => v > 0) ? date : null) : undefined })
            }} />
            <span className="hint">全体を確認した日。曜日ごとに更新した場合は最も古い確認日を表示します。</span>
          </label>
        </div>
        <label className="line">
          <input type="checkbox" className="check" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
          <span>主なエリアにする（計画と「続ける？帰る？」の見込みに使う）</span>
        </label>
        {!primary && (
          <IntInput
            label="主なエリアからの移動（任意）"
            unit="分"
            value={area.moveMinutes ?? null}
            onChange={(v) => setArea({ ...area, moveMinutes: v })}
            tip="入れると、稼働中の「終了までの見通し」で、このエリアへ移動する案も比べます。移動している間は稼げない時間として数えます。主なエリアを変えたら、入れ直してください"
          />
        )}
        {!primary && area.moveMinutes != null && area.moveFromAreaId && area.moveFromAreaId !== primaryId && (
          <p className="hint" role="status">⚠️ この移動の分は、前の主なエリアから測った値です。今の主なエリアからの分に直して保存してください</p>
        )}
      </section>

      <section className="card stack">
        <CardTitle tip="配達アプリの棒の濃さを見ながら、マスを押して段階を切り替えます（押すたびに 1 空き → 2 → 3 → 4 混む → 未入力）。表は配達アプリと同じく 4時〜翌3時 で1日です。">
          ⏱️ 時間帯ごとの傾向
        </CardTitle>
        <div className="segmented" role="tablist" aria-label="曜日">
          {WEEK_ORDER.map((d) => (
            <button key={d} type="button" role="tab" aria-selected={day === d} onClick={() => setDay(d)}>
              {WEEKDAY_LABELS[d]}
            </button>
          ))}
        </div>
        {[
          { label: '☀️ 昼の部（4〜15時）', hours: BUSINESS_HOURS.slice(0, 12) },
          { label: '🌙 夜の部（16〜翌3時）', hours: BUSINESS_HOURS.slice(12) },
        ].map((half) => (
          <div key={half.label} className="busy-half">
            <p className="busy-half-label">{half.label}</p>
            <div className="busy-grid" role="group" aria-label={`${WEEKDAY_LABELS[day]}曜日の${half.label}`}>
              {half.hours.map((hour) => {
                const level = row[hour]!
                return (
                  <button
                    key={hour}
                    type="button"
                    className={`busy-cell level-${level}`}
                    aria-label={`${WEEKDAY_LABELS[day]}曜 ${hour}時：${LEVEL_LABELS[level]}`}
                    onClick={() => cycle(hour)}
                  >
                    <span className="busy-plot" aria-hidden="true">
                      {/* 数字は棒の中（根元）に置き、短い棒でも重なるようにする */}
                      {level > 0 ? (
                        <span className="busy-bar" style={{ height: `${level * 25}%` }}>
                          <span className="busy-level">{level}</span>
                        </span>
                      ) : (
                        <span className="busy-level busy-empty">·</span>
                      )}
                    </span>
                    <span className="busy-hour" aria-hidden="true">{hour}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        <p className="hint">1 空き・2 やや空き・3 やや混む・4 混む（「·」は未入力）</p>
        <p className="hint">{WEEKDAY_LABELS[day]}曜の確認日：{areaDayDates(area)[day] ?? '未確認'}</p>
        <button type="button" disabled={row.some(v => v === 0)} onClick={() => setArea(markAreaDays(area, [day], localToday()))}>この曜日を今日確認した</button>
        <BusyScreenshotImport
          current={area.levels}
          onApply={(readings, checkedAt) => {
            setBeforeImport(area)
            const levels = area.levels.map((d, weekday) => {
              const r = readings.find((x) => x.weekday === weekday)
              return r ? d.map((_, hour) => r.levels[BUSINESS_HOURS.indexOf(hour)]!) : d
            })
            setArea(markAreaDays({ ...area, levels }, readings.map(r => r.weekday), checkedAt))
            setDay(readings[0]!.weekday)
          }}
        />
        {beforeImport && <Notice message="読み取り結果を表に反映しました（まだ保存していません）" onClose={() => setBeforeImport(null)} onUndo={() => {
          setArea(a => ({ ...a, levels: beforeImport.levels, checkedAt: beforeImport.checkedAt, checkedByDay: beforeImport.checkedByDay }))
          setBeforeImport(null)
        }} />}
        <div className="buttons">
          <button type="button" onClick={() => copyFrom(previousDay)}>⬅ {WEEKDAY_LABELS[previousDay]}曜と同じ</button>
          <button type="button" onClick={() => copyTo([1, 2, 3, 4, 5])}>📋 平日に写す</button>
          <button type="button" onClick={() => copyTo([0, 1, 2, 3, 4, 5, 6])}>📋 全曜日に写す</button>
        </div>
      </section>

      <details className="card fold" onToggle={(e) => setMapOpen(e.currentTarget.open)}>
        <summary>
          <strong>🗺️ 地図の場所（任意）</strong>
          <span className="hint">{area.center ? `設定済み・半径${(area.radiusM ?? 1000) >= 1000 ? `${(area.radiusM ?? 1000) / 1000}km` : `${area.radiusM}m`}` : '未設定'}</span>
        </summary>
        <div className="stack">
          <p className="hint">
            ホームの地図で、このエリアを混み具合の色の円で出します。配達アプリのエリアの形は写さず、中心と半径の円での目安です。地図は OpenStreetMap から読み込みます（記録や現在地は送りません）。
          </p>
          {mapOpen && (
            <MapPicker
              center={area.center ?? null}
              radiusM={area.radiusM ?? 1000}
              others={others}
              onChange={(center, radiusM) => setArea((a) => ({ ...a, center, radiusM: center ? radiusM : null }))}
            />
          )}
        </div>
      </details>

      <section className="card stack">
        <label className="field">
          <span>このエリアに入る地名（任意）</span>
          <textarea rows={2} value={townsText} onChange={(e) => setTownsText(e.target.value)} placeholder="例：高円寺、阿佐谷、荻窪" />
        </label>
        <p className="hint">「、」か改行で区切ります。オファー判定で、届け先の地名からエリアを探すのに使います。</p>
      </section>

      <Problems items={problems} />
      <div className="actions">
        <button type="submit" className="primary">💾 保存</button>
        <button type="button" onClick={onCancel}>やめる</button>
      </div>
    </form>
  )
}
