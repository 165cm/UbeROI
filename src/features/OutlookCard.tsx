// 稼働中の「🏁 終了までの見通し」。終了予定の時刻を決めると、今日のペースとこの先の混み具合から、
// 続ける／休憩して再開／今やめるの、この先の利益を比べる。止まっている時に確かめる前提で、走行中の操作は求めない
import { useEffect, useMemo, useState } from 'react'
import { deadlineMs, endTimeMs, estimateRevenue, evaluateOutlook, tieredCapInfo, type BusynessTable, type OutlookAction, type OutlookOffer, type PastSession, type Tariff } from '../domain'
import { CardTitle, IntInput, Tip } from '../components/fields'
import { formatYen } from '../format'
import { loadPrefs } from './ContinueCard'

const ACTION_LABELS: Record<OutlookAction, string> = { continue: 'このまま続ける', break: '休憩して再開', move: 'エリアを移動', stop: '今やめて帰る' }
const LEVEL_MARKS = ['·', '▮', '▮▮', '▮▮▮', '▮▮▮▮'] as const

const STORE_KEY = 'deli-kan:outlook'
interface Stored {
  sessionId: string
  end: string
  manualRevenueYen: number | null
}
function load(sessionId: string): Stored | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Stored | null
    return v?.sessionId === sessionId ? v : null
  } catch {
    return null
  }
}
function save(v: Stored) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v))
  } catch {
    // 覚えられなくても、この画面では使える
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
/** 日本時間の HH:mm */
function jstClock(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/**
 * 終了予定の初期値：帰宅締切から家までの時間を引いた時刻（15分単位で切り下げ。今より前なら今）。
 * 締切がなければ2時間後の正時
 */
function defaultEnd(nowIso: string, homeDeadline: string | null, departedAt: string, minutesToHome: number): string {
  const q = 15 * 60_000
  const nowMs = Date.parse(nowIso)
  if (homeDeadline) return jstClock(Math.max(nowMs, Math.floor((deadlineMs(departedAt, homeDeadline) - minutesToHome * 60_000) / q) * q))
  return jstClock(Math.floor((nowMs + 2 * 3_600_000) / 3_600_000) * 3_600_000)
}

function formatLeft(minutes: number): string {
  const h = Math.floor(minutes / 60)
  return h > 0 ? `${h}時間${minutes % 60}分` : `${minutes}分`
}

export function OutlookCard({
  now,
  sessionId,
  departedAt,
  rental,
  past,
  busyness,
  offers,
  allOffers,
  targetHourlyYen,
  homeDeadline,
  moveAreas,
}: {
  now: string
  sessionId: string
  departedAt: string
  rental: { tariff: Tariff; startAt: string } | null
  past: PastSession[]
  busyness: BusynessTable | null
  offers: OutlookOffer[]
  allOffers: OutlookOffer[]
  targetHourlyYen: number | null
  homeDeadline: string | null
  /** 移動の候補にするエリア（主なエリア以外で、移動の分を登録したもの） */
  moveAreas: { name: string; minutes: number; levels: BusynessTable }[]
}) {
  const prefs = loadPrefs()
  const [stored, setStored] = useState<Stored>(
    () => load(sessionId) ?? { sessionId, end: defaultEnd(now, homeDeadline, departedAt, prefs.minutesToHome), manualRevenueYen: null },
  )
  useEffect(() => save(stored), [stored])

  // 1分ごとに見直す（毎秒の計算はしない）
  const minute = `${now.slice(0, 16)}:00.000Z`
  const result = useMemo(() => {
    const endAt = new Date(endTimeMs(minute, stored.end)).toISOString()
    return evaluateOutlook({
      now: minute,
      departedAt,
      endAt,
      offers,
      allOffers,
      manualRevenueYen: stored.manualRevenueYen,
      estimate: (s, e) => estimateRevenue(s, e, past, busyness).revenueYen,
      busyness,
      rental,
      minutesToReturnBike: rental ? prefs.minutesToReturnBike : 0,
      minutesToHome: prefs.minutesToHome,
      homeDeadline,
      deadlineMs: homeDeadline ? deadlineMs(departedAt, homeDeadline) : null,
      targetHourlyYen,
      moves: moveAreas.map((a) => ({ name: a.name, minutes: a.minutes, busyness: a.levels, estimate: (st: string, e: string) => estimateRevenue(st, e, past, a.levels).revenueYen })),
    })
    // 実績・レンタル・好みは毎秒作り直される値なので、件数と分が変わった時だけ計算し直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minute, departedAt, stored, offers, allOffers, past.length, busyness, rental?.startAt, rental?.tariff, homeDeadline, targetHourlyYen, moveAreas.map((a) => `${a.name}:${a.minutes}`).join()])

  const { soFar } = result
  // レンタル中の段階料金：終了予定までに上限に達するなら、その後は追加のレンタル代がかからないことを伝える
  const capNote = (() => {
    if (!rental || rental.tariff.kind !== 'tiered') return null
    const cap = tieredCapInfo(rental.tariff)
    if (!cap) return null
    const start = Date.parse(rental.startAt)
    const reachMs = start + cap.reachesCapAtSeconds * 1000
    const untilMs = start + cap.coversUntilSeconds * 1000
    const nowMs = Date.parse(minute)
    const endMs = endTimeMs(minute, stored.end)
    const clock = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(11, 16)
    // 上限で乗れる時間（例：12時間）を過ぎた後は、追加料金なしとは言えない（見積の対象外）
    if (nowMs >= untilMs || endMs <= reachMs) return null
    const beyond = endMs > untilMs ? `。ただし ${clock(untilMs)} を過ぎるとレンタル代は見積の対象外です（返して借り直すと料金は最初から）` : ''
    if (nowMs >= reachMs) return `レンタルは上限 ${formatYen(cap.capYen)} に達しています。${clock(untilMs)} までは追加のレンタル代がかかりません${beyond}`
    return `レンタルは ${clock(reachMs)} に上限 ${formatYen(cap.capYen)} に達し、${clock(untilMs)} までは追加のレンタル代がかかりません（この差は上の利益に入っています）${beyond}`
  })()
  return (
    <section className="card stack" aria-labelledby="outlook-title">
      <CardTitle
        id="outlook-title"
        tip="止まっている時に確かめてください（走行中は操作しないでください）。終了予定までの時間を、このまま続ける・休憩して再開する・ほかのエリアへ移動する（設定 → エリアで移動の分を入れたエリア）・今やめて帰るで比べます。移動は、移動しない一番良い案より200円以上良い時だけ勧めます。この先の売上は、混み具合と自分の実績から出す普段の見込みに、今日のペース（普段の見込みとの比）を半分だけ反映した目安です。すでに稼いだ分はどれを選んでも同じなので比べません。目標の時給があれば、それを上回る分が一番大きい行動を勧めます（今やめる場合との差が200円未満なら早く帰る方）。今日のここまでは、オファー判定で「受けた」と記録した報酬の合計です。"
      >
        🏁 終了までの見通し
      </CardTitle>
      <div className="line">
        <label className="field grow">
          <span>終了予定（配達をやめる時刻）</span>
          <input type="time" value={stored.end} onChange={(e) => e.target.value && setStored({ ...stored, end: e.target.value })} />
        </label>
        <strong className="num">あと{formatLeft(result.minutesLeft)}</strong>
      </div>

      <dl className="stats">
        <div>
          <dt>今日のここまで</dt>
          <dd>{soFar.revenueYen === null ? '記録なし' : `${formatYen(soFar.revenueYen)}${soFar.source === 'offers' ? `・${soFar.accepted}件` : '（手入力）'}`}</dd>
        </div>
        <div>
          <dt>売上の時給</dt>
          <dd>{soFar.hourlyYen === null ? '—' : `${formatYen(soFar.hourlyYen)}/時`}</dd>
        </div>
        <div>
          <dt>今日のペース</dt>
          <dd>{result.paceRatio === null ? '—' : `普段の${Math.round(result.paceRatio * 100)}%`}</dd>
        </div>
        <div>
          <dt>直近60分</dt>
          <dd>{result.recent.accepted}件・{formatYen(result.recent.revenueYen)}</dd>
        </div>
        <div className="wide">
          <dt>最後のオファーから</dt>
          <dd>{result.minutesSinceLastOffer}分{result.typicalGapMinutes !== null ? `（普段の間隔 ${result.typicalGapMinutes}分）` : ''}</dd>
        </div>
      </dl>

      {busyness && result.timeline.length > 0 && (
        <p className="busy-timeline" aria-label={`この先の混み具合：${result.timeline.map((t) => `${t.hour}時台 段階${t.level ?? '未入力'}`).join('、')}`}>
          {result.timeline.map((t) => (
            <span key={t.hour}>
              <span className="hint">{t.hour}時</span> <span aria-hidden="true">{LEVEL_MARKS[t.level ?? 0]}</span>
            </span>
          ))}
        </p>
      )}

      <ul className="list outlook-options" aria-label="行動ごとのこの先の利益">
        {result.options.map((o) => {
          const picked = o.action === result.recommended
          return (
            <li key={o.action} className={`line${picked ? ' picked' : ''}`}>
              <span className="grow">
                {picked ? '▶ ' : ''}
                {o.action === 'break' ? `${o.breakMinutes}分休憩して再開` : o.action === 'move' ? `${o.areaName}へ移動（${o.moveMinutes}分）` : ACTION_LABELS[o.action]}
                {picked && <span className="tag">おすすめ</span>}
              </span>
              <span className="num">
                {o.profitYen === null ? '算出不可' : `${o.profitYen > 0 ? '+' : ''}${formatYen(o.profitYen)}`}
                {o.hourlyYen !== null && (
                  <>
                    <br />
                    <span className="hint">{formatYen(o.hourlyYen)}/時</span>
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <div role="status">
        <ul className="reasons">
          {result.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
          {capNote && <li>{capNote}</li>}
        </ul>
      </div>

      <details>
        <summary>今日の売上を手で入れる</summary>
        <div className="line">
          <span className="grow">
            <IntInput
              label="今日のここまでの売上"
              unit="円"
              value={stored.manualRevenueYen}
              onChange={(v) => setStored({ ...stored, manualRevenueYen: v })}
              placeholder={soFar.source === 'offers' && soFar.revenueYen !== null ? `記録：${soFar.revenueYen}` : '未入力'}
            />
          </span>
          <Tip label="今日の売上の入れ方">
            オファー判定で「受けた」を記録していない時は、配達アプリの今日の売上をここに入れると、今日のペースが出ます。空欄に戻すと記録の合計を使います。見込みの計算だけに使い、確定した記録には入りません。
          </Tip>
        </div>
      </details>
    </section>
  )
}
