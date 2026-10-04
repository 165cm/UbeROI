// 稼働中の「続ける？帰る？」（GO/WAIT/STOP）。止まっている時に確かめる前提で、走行中の操作は求めない
import { useEffect, useMemo, useState } from 'react'
import {
  SCENARIOS,
  SCENARIO_FACTORS,
  SCENARIO_LABELS,
  estimateRevenue,
  evaluateContinuation,
  type Decision,
  type PastSession,
  type Scenario,
  type Tariff,
} from '../domain'
import { IntInput } from '../components/fields'
import { formatClock, formatYen } from '../format'

const DECISION_LABELS: Record<Decision, string> = {
  GO: '✅ GO：続けてOK',
  WAIT: '⏸️ WAIT：様子見',
  STOP: '🛑 STOP：帰ろう',
}

const PREFS_KEY = 'deli-kan:continue-prefs'
interface Prefs {
  minutesToHome: number
  minutesToReturnBike: number
}
function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null
    return { minutesToHome: v?.minutesToHome ?? 15, minutesToReturnBike: v?.minutesToReturnBike ?? 5 }
  } catch {
    return { minutesToHome: 15, minutesToReturnBike: 5 }
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    // 覚えられなくても、この画面では使える
  }
}

export function ContinueCard({
  now,
  departedAt,
  rental,
  past,
  targetHourlyYen,
  homeDeadline,
}: {
  now: string
  departedAt: string
  rental: { tariff: Tariff; startAt: string } | null
  past: PastSession[]
  targetHourlyYen: number | null
  homeDeadline: string | null
}) {
  const [extendMinutes, setExtendMinutes] = useState(30)
  const [prefs, setPrefs] = useState(loadPrefs)
  const [manualRevenue, setManualRevenue] = useState<number | null>(null)
  const [questGain, setQuestGain] = useState<number | null>(null)
  useEffect(() => savePrefs(prefs), [prefs])

  // 1分ごとに見直す（毎秒の計算はしない）
  const minute = now.slice(0, 16)
  const estimate = useMemo(() => {
    const start = `${minute}:00.000Z`
    const end = new Date(Date.parse(start) + extendMinutes * 60_000).toISOString()
    return estimateRevenue(start, end, past)
  }, [minute, extendMinutes, past])

  const standard = manualRevenue ?? estimate.revenueYen
  const revenue = {} as Record<Scenario, number>
  for (const s of SCENARIOS) revenue[s] = Math.round(standard * SCENARIO_FACTORS[s])

  const result = evaluateContinuation({
    now,
    departedAt,
    extendMinutes,
    extraRevenueYen: revenue,
    questGainYen: questGain ?? 0,
    rental,
    minutesToReturnBike: rental ? prefs.minutesToReturnBike : 0,
    minutesToHome: prefs.minutesToHome,
    targetHourlyYen,
    homeDeadline,
  })

  return (
    <section className="card stack" aria-labelledby="continue-title">
      <h3 id="continue-title">🤔 続ける？帰る？</h3>
      <p className="hint">止まっている時に確かめてください（走行中は操作しないでください）。</p>
      <div className="segmented" role="radiogroup" aria-label="延長する時間">
        {[30, 60, 90].map((m) => (
          <button key={m} type="button" role="radio" aria-checked={extendMinutes === m} aria-label={`あと${m}分`} onClick={() => setExtendMinutes(m)}>
            +{m}分
          </button>
        ))}
      </div>

      <p className={`decision decision-${result.decision.toLowerCase()}`} role="status">
        <strong>{DECISION_LABELS[result.decision]}</strong>
      </p>
      <ul className="reasons">
        {result.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>

      <dl className="stats">
        <div><dt>延長した分の売上（標準）</dt><dd>{formatYen(standard)}{manualRevenue === null ? '（見込み）' : '（手入力）'}</dd></div>
        <div><dt>増えるレンタル代</dt><dd>{result.extraRentalYen === null ? '算出不可' : formatYen(result.extraRentalYen)}</dd></div>
        <div><dt>延長した場合の帰宅</dt><dd>{formatClock(result.arrivalIfExtended).slice(0, 5)}ごろ</dd></div>
      </dl>
      <div className="table-scroll">
        <table className="breakdown">
          <thead>
            <tr><th scope="col">見込み</th><th scope="col">増える利益</th><th scope="col">追加の時給</th></tr>
          </thead>
          <tbody>
            {SCENARIOS.map((s) => (
              <tr key={s}>
                <th scope="row">{SCENARIO_LABELS[s]}</th>
                <td>{formatYen(result.deltaProfitYen[s])}</td>
                <td>{result.hourlyYen[s] === null ? '算出不可' : `${formatYen(result.hourlyYen[s])}/時`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">見込みの出どころ：{manualRevenue === null ? estimate.note : '手入力'}。悲観・楽観は標準の0.8倍・1.2倍の目安です。</p>

      <details>
        <summary>見込みや移動時間を直す</summary>
        <div className="stack">
          <IntInput label={`あと${extendMinutes}分の売上の見込み（標準）`} unit="円" value={manualRevenue} onChange={setManualRevenue} placeholder={`自動：${estimate.revenueYen}`} hint="空欄なら自動の見込みを使います" />
          <IntInput label="クエストで増えそうな額（見込み）" unit="円" value={questGain} onChange={setQuestGain} hint="確定していない額は実績の売上には入りません" />
          <IntInput label="やめてから家に着くまで" unit="分" value={prefs.minutesToHome} onChange={(v) => setPrefs({ ...prefs, minutesToHome: v ?? 0 })} />
          {rental && (
            <IntInput label="やめてから自転車を返すまで" unit="分" value={prefs.minutesToReturnBike} onChange={(v) => setPrefs({ ...prefs, minutesToReturnBike: v ?? 0 })} />
          )}
        </div>
      </details>
    </section>
  )
}
