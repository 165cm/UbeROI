// 分析（S04）：期間の損益・本当の時給・投資回収の推移・内訳。すべて税引前・確定した記録のみ
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  TIME_SLOT_LABELS,
  breakdown,
  divide,
  forecastRecoveryMonths,
  localDate,
  periodRange,
  recoverySeries,
  shiftPeriod,
  timeSlotOf,
  toCsv,
  weekdayOf,
  type BreakdownRow,
  type PeriodKind,
} from '../domain'
import { BarList, LineChart } from '../components/charts'
import { localToday } from '../components/fields'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { PLATFORM_LABELS, WEATHER_LABELS, type SessionRecord } from '../storage/schema'
import { cashEventsFor, periodFor, recoveryFor } from '../storage/toDomain'

type Kind = PeriodKind | 'custom'
const KINDS: { id: Kind; label: string }[] = [
  { id: 'day', label: '日' },
  { id: 'week', label: '週' },
  { id: 'month', label: '月' },
  { id: 'year', label: '年' },
  { id: 'custom', label: '任意' },
]

/** 副業（給与所得者）で確定申告が必要になる所得の目安 */
const SIDE_JOB_FILING_LINE_YEN = 200_000

const perHour = (v: number | null) => (v === null ? '算出不可' : `${formatYen(v)}/時`)

function periodLabel(kind: Kind, from: string, to: string): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
  if (kind === 'day') return `${from.slice(0, 4)}年${md(from)}`
  if (kind === 'month') return `${from.slice(0, 4)}年${Number(from.slice(5, 7))}月`
  if (kind === 'year') return `${from.slice(0, 4)}年`
  return `${md(from)}〜${md(to)}`
}

export function Analytics() {
  const { db } = useData()
  const data = useLiveQuery(async () => ({
    sessions: await db.sessions.toArray(),
    recurringExpenses: await db.recurringExpenses.toArray(),
    assets: await db.assets.toArray(),
    plans: await db.plans.toArray(),
    settings: await db.settings.get('settings'),
  }), [db])
  const today = localToday()
  const [kind, setKind] = useState<Kind>('month')
  const [anchor, setAnchor] = useState(today)
  const [custom, setCustom] = useState({ from: `${today.slice(0, 7)}-01`, to: today })

  const range = kind === 'custom' ? custom : periodRange(kind, anchor)
  const validRange = range.from <= range.to

  const result = useMemo(() => {
    if (!data || !validRange) return null
    const settled = { ...data, sessions: data.sessions.filter((s) => s.status !== 'active') }
    const period = periodFor(settled, range.from, range.to)
    const byId = new Map(data.sessions.map((s) => [s.id, s]))
    const rows = period.rows.map((r) => ({ row: r, session: byId.get(r.id)! }))
    const value = (x: (typeof rows)[number]) => ({ hours: x.row.result.hours ?? 0, operatingProfitYen: x.row.result.operatingProfitYen ?? 0 })
    const nowIso = new Date().toISOString()
    const events = cashEventsFor(data, nowIso)
    const year = periodFor(settled, `${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`)
    // 直近90日のレンタル代（購入とレンタルの比較に使う）
    const ninetyAgo = new Date(Date.now() - 90 * 86_400_000).toISOString()
    const recent = periodFor(settled, localDate(ninetyAgo), today)
    return {
      period,
      rows,
      byWeather: breakdown(rows, (x) => (x.session.weather ? WEATHER_LABELS[x.session.weather] : '記録なし'), value),
      bySlot: breakdown(rows, (x) => TIME_SLOT_LABELS[timeSlotOf(x.session.departedAt)], value),
      byWeekday: breakdown(rows, (x) => `${weekdayOf(x.session.returnedAt!)}曜`, value),
      byPlatform: breakdown(rows, (x) => PLATFORM_LABELS[x.session.platform], value),
      recovery: recoveryFor(data, nowIso),
      series: recoverySeries(events),
      yearProfit: year.totals.operatingProfitYen,
      monthlyRentalYen: recent.totals.rentalYen / 3,
    }
  }, [data, range.from, range.to, validRange, today])

  if (!data) return <p className="loading">読み込み中…</p>

  const target = data.settings?.targetHourlyYen ?? null
  const vehicle = data.plans.flatMap((p) => p.items).find((i) => i.category === 'vehicle' && i.unitYen !== null && i.state === 'planned')

  const exportCsv = () => {
    if (!result) return
    const csv = toCsv(
      ['出発', '帰宅', 'サービス', '天気', 'エリア', '件数', '売上', 'レンタル', 'その他経費', '固定費配分', '営業純利益', '投資配賦', '配賦後利益', '拘束時間'],
      result.rows.map(({ row, session }) => [
        session.departedAt,
        session.returnedAt,
        PLATFORM_LABELS[session.platform],
        session.weather ? WEATHER_LABELS[session.weather] : '',
        session.areaLabel,
        row.result.completedCount,
        row.result.revenueYen,
        row.result.rentalYen,
        row.result.directExpenseYen,
        row.result.fixedCostYen,
        row.result.operatingProfitYen,
        row.result.allocatedInvestmentYen,
        row.result.afterAllocationProfitYen,
        row.result.hours === null ? null : Number(row.result.hours.toFixed(2)),
      ]),
    )
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `deli-kan-${range.from}_${range.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="stack">
      <div className="segmented" role="tablist" aria-label="期間の種類">
        {KINDS.map((k) => (
          <button key={k.id} type="button" role="tab" aria-selected={kind === k.id} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      {kind === 'custom' ? (
        <div className="row">
          <label className="field">
            <span>開始日</span>
            <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          </label>
          <label className="field">
            <span>終了日</span>
            <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </label>
        </div>
      ) : (
        <div className="period-nav">
          <button type="button" aria-label="前の期間" onClick={() => setAnchor(shiftPeriod(kind, anchor, -1))}>‹</button>
          <strong>{periodLabel(kind, range.from, range.to)}</strong>
          <button type="button" aria-label="次の期間" onClick={() => setAnchor(shiftPeriod(kind, anchor, 1))}>›</button>
        </div>
      )}
      <p className="hint">税引前・確定した記録のみ。日をまたいだ稼働は帰宅日（日本時間）に入れます。</p>

      {!validRange || !result ? (
        <p className="problems" role="alert">開始日は終了日以前にしてください。</p>
      ) : (
        <>
          <section className="card" aria-labelledby="kpi-title">
            <h3 id="kpi-title">📊 {periodLabel(kind, range.from, range.to)}の成績</h3>
            <dl className="stats">
              <div><dt>営業純利益</dt><dd className="big">{formatYen(result.period.totals.operatingProfitYen)}</dd></div>
              <div>
                <dt>営業純時給</dt>
                <dd>
                  {perHour(result.period.totals.hourlyYen)}
                  {target !== null && result.period.totals.hourlyYen !== null && (result.period.totals.hourlyYen >= target ? '（🎯 目標以上）' : '（目標未満）')}
                </dd>
              </div>
              <div><dt>投資配賦後の時給</dt><dd>{perHour(result.period.totals.afterAllocationHourlyYen)}</dd></div>
              <div><dt>稼働</dt><dd>{result.rows.length}回・{result.period.totals.hours.toFixed(1)}時間・{result.period.totals.completedCount}件</dd></div>
              <div><dt>1件あたり営業利益</dt><dd>{formatYen(divide(result.period.totals.operatingProfitYen, result.period.totals.completedCount))}</dd></div>
            </dl>
            <p className="hint">時給＝期間の利益合計 ÷ 出発〜帰宅の時間合計（1回ごとの時給の平均ではありません）。</p>
            {result.period.excludedDrafts + result.period.excludedInvalid > 0 && (
              <p className="hint">⚠️ 下書き {result.period.excludedDrafts}件・要確認 {result.period.excludedInvalid}件は集計に入っていません。</p>
            )}
            {result.period.partialMonthsNote.length > 0 && (
              <p className="hint">稼働のない月（{result.period.partialMonthsNote.join('、')}）の固定費・配賦は、月単位で見ると入ります。</p>
            )}
          </section>

          <section className="card" aria-labelledby="wf-title">
            <h3 id="wf-title">🧮 売上から利益まで</h3>
            <BarList
              title="売上から投資配賦後の利益までの内訳"
              rows={[
                { label: '売上', value: result.period.totals.revenueYen, emphasis: true, display: formatYen(result.period.totals.revenueYen) },
                { label: '− レンタル', value: result.period.totals.rentalYen, emphasis: false, display: `−${formatYen(result.period.totals.rentalYen)}` },
                { label: '− その他経費', value: result.period.totals.directExpenseYen, emphasis: false, display: `−${formatYen(result.period.totals.directExpenseYen)}` },
                { label: '− 固定費', value: result.period.totals.fixedCostYen, emphasis: false, display: `−${formatYen(result.period.totals.fixedCostYen)}` },
                { label: '＝ 営業純利益', value: result.period.totals.operatingProfitYen, emphasis: true, display: formatYen(result.period.totals.operatingProfitYen) },
                { label: '− 投資配賦', value: result.period.totals.allocatedInvestmentYen, emphasis: false, display: `−${formatYen(result.period.totals.allocatedInvestmentYen)}` },
                { label: '＝ 配賦後利益', value: result.period.totals.afterAllocationProfitYen, emphasis: true, display: formatYen(result.period.totals.afterAllocationProfitYen) },
              ]}
            />
            <button type="button" onClick={exportCsv} disabled={result.rows.length === 0}>⬇️ この期間の記録をCSVで書き出す</button>
          </section>

          <section className="card stack" aria-labelledby="rec-title">
            <h3 id="rec-title">💰 投資の回収（現金ベース・全期間）</h3>
            {result.recovery.investedYen === 0 ? (
              <p className="hint">購入した装備・車両がまだありません。「設定 → 装備と投資」で「購入した」を登録すると、回収の推移が出ます。</p>
            ) : (
              <>
                <dl className="stats">
                  <div><dt>現金投資</dt><dd>{formatYen(result.recovery.investedYen)}</dd></div>
                  <div><dt>回収残額</dt><dd className="big">{result.recovery.remainingYen === 0 ? '✅ 回収済み' : formatYen(result.recovery.remainingYen)}</dd></div>
                  <div><dt>回収率</dt><dd>{result.recovery.recoveryRate === null ? '算出不可' : `${(result.recovery.recoveryRate * 100).toFixed(1)}%`}</dd></div>
                  <div><dt>投資ROI</dt><dd>{result.recovery.roi === null ? '算出不可' : `${(result.recovery.roi * 100).toFixed(1)}%`}</dd></div>
                  <RecoveryForecast remainingYen={result.recovery.remainingYen} data={data} today={today} />
                </dl>
                <h4 className="chart-title">投資込みの累積キャッシュ（0円を超えたら回収済み）</h4>
                <LineChart
                  title="投資込みの累積キャッシュの推移"
                  describe={`最新の累積キャッシュは${formatYen(result.series[result.series.length - 1]?.netCashYen ?? 0)}です`}
                  points={result.series.map((p) => ({ label: `${Number(p.date.slice(5, 7))}/${Number(p.date.slice(8, 10))}`, value: p.netCashYen }))}
                  format={(v) => formatYen(v)}
                />
              </>
            )}
          </section>

          <section className="card stack" aria-labelledby="buy-title">
            <h3 id="buy-title">🚲 買うか借りるか（推計）</h3>
            <dl className="stats">
              <div><dt>直近90日のレンタル代（月あたり）</dt><dd>{formatYen(result.monthlyRentalYen)}</dd></div>
              {vehicle && (
                <div>
                  <dt>{vehicle.label}（{formatYen((vehicle.unitYen ?? 0) * vehicle.quantity)}）の元が取れるまで</dt>
                  <dd>
                    {result.monthlyRentalYen > 0
                      ? `約${(((vehicle.unitYen ?? 0) * vehicle.quantity) / result.monthlyRentalYen).toFixed(1)}か月`
                      : 'レンタル代がないため算出不可'}
                  </dd>
                </div>
              )}
            </dl>
            <p className="hint">
              {vehicle
                ? '今のペースでレンタル代がなくなった場合の推計です。充電・修理・バッテリー交換などの維持費（月1,500〜3,000円程度が目安）は含めていません。'
                : '「設定 → 装備と投資」で「🚲 車両を追加」し価格を入れると、購入の元が取れるまでの月数を出します。'}
            </p>
          </section>

          <section className="card stack" aria-labelledby="tax-title">
            <h3 id="tax-title">🧾 今年の所得の目安（{today.slice(0, 4)}年）</h3>
            <dl className="stats">
              <div><dt>営業純利益（売上 − 経費）</dt><dd className="big">{formatYen(result.yearProfit)}</dd></div>
              <div><dt>副業の確定申告の目安</dt><dd>{formatYen(SIDE_JOB_FILING_LINE_YEN)}{result.yearProfit > SIDE_JOB_FILING_LINE_YEN ? '（⚠️ 超えています）' : ''}</dd></div>
            </dl>
            <p className="hint">給与所得のある副業の一般的な目安です。税務上の経費や減価償却とは一致しません。個別の判断は税務署・税理士に確認してください。</p>
          </section>

          <Breakdown title="🌦️ 天気別" rows={result.byWeather} />
          <Breakdown title="🕐 出発の時間帯別" rows={result.bySlot} />
          <Breakdown title="📅 曜日別（帰宅日）" rows={result.byWeekday} />
          <Breakdown title="📱 サービス別" rows={result.byPlatform} />
        </>
      )}
    </div>
  )
}

function RecoveryForecast({ remainingYen, data, today }: { remainingYen: number; data: { sessions: SessionRecord[]; recurringExpenses: Parameters<typeof periodFor>[0]['recurringExpenses']; assets: Parameters<typeof periodFor>[0]['assets'] }; today: string }) {
  // 直近3か月の現金余剰の月平均で割る（予測。前提を表示する）
  const from = localDate(new Date(Date.now() - 90 * 86_400_000).toISOString())
  const recent = periodFor({ ...data, sessions: data.sessions.filter((s) => s.status !== 'active') }, from, today)
  const monthly = recent.totals.operatingProfitYen / 3
  const months = forecastRecoveryMonths(remainingYen, monthly)
  if (remainingYen === 0) return null
  return (
    <div>
      <dt>回収までの見込み（予測）</dt>
      <dd>{months === null ? '回収見込みなし（直近の利益が0以下）' : `約${months.toFixed(1)}か月（直近90日のペース）`}</dd>
    </div>
  )
}

function Breakdown({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  if (rows.length === 0) return null
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.hourlyYen ?? 0)))
  return (
    <section className="card stack">
      <h3>{title}</h3>
      <div className="table-scroll">
        <table className="breakdown">
          <thead>
            <tr>
              <th scope="col">区分</th>
              <th scope="col">回数</th>
              <th scope="col">時間</th>
              <th scope="col">営業純時給</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.lowSample ? 'low-sample' : undefined}>
                <th scope="row">{r.key}</th>
                <td>{r.count}{r.lowSample && <span className="tag">参考</span>}</td>
                <td>{r.hours.toFixed(1)}h</td>
                <td>
                  <span className="cell-bar" aria-hidden="true" style={{ width: `${(Math.abs(r.hourlyYen ?? 0) / max) * 100}%` }} />
                  {perHour(r.hourlyYen)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.lowSample) && <p className="hint">「参考」は10回未満で、偶然の差が大きい区分です。比較の根拠にしすぎないでください。</p>}
    </section>
  )
}
