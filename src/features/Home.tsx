// ホーム（S02）：今日の状態・稼働中のレンタル料金・今月の成績
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { calculateRental, localDate } from '../domain'
import { Problems, errorMessages } from '../components/fields'
import { formatClock, formatDuration, formatYen } from '../format'
import { useData } from '../storage/context'
import { arriveHome, departNow, endRental, listTariffs, pickDefaultTariff, startRental } from '../storage/repo'
import { periodFor } from '../storage/toDomain'

function useNow(active: boolean): string {
  const [now, setNow] = useState(() => new Date().toISOString())
  // 経過時間はタイマーの回数ではなく、保存した開始日時との差で毎回計算する（再読み込み・休止後も正しい）
  useEffect(() => {
    if (!active) return
    setNow(new Date().toISOString())
    const id = window.setInterval(() => setNow(new Date().toISOString()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

export function Home({ onSettle }: { onSettle: (sessionId: string) => void }) {
  const { db } = useData()
  const data = useLiveQuery(async () => ({
    sessions: await db.sessions.toArray(),
    recurringExpenses: await db.recurringExpenses.toArray(),
    assets: await db.assets.toArray(),
    tariffs: await listTariffs(db),
    settings: await db.settings.get('settings'),
  }), [db])
  const active = data?.sessions.find((s) => s.status === 'active')
  const now = useNow(Boolean(active))
  const [problems, setProblems] = useState<string[]>([])
  const [tariffId, setTariffId] = useState<string>('')

  if (!data) return <p className="loading">読み込み中…</p>

  const run = async (fn: () => Promise<unknown>) => {
    setProblems([])
    try {
      await fn()
    } catch (e) {
      setProblems(errorMessages(e))
    }
  }

  const today = localDate(now)
  const monthStart = `${today.slice(0, 7)}-01`
  // 稼働中の記録は確定集計に入れない（下書きの件数にも数えない）
  const settled = { ...data, sessions: data.sessions.filter((s) => s.status !== 'active') }
  const todayResult = periodFor(settled, today, today)
  const month = periodFor(settled, monthStart, today)
  const drafts = data.sessions.filter((s) => s.status === 'draft')
  const awaitingSettle = drafts.filter((s) => s.returnedAt).length
  const openRental = active?.rentals.find((r) => r.startAt && !r.endAt)
  const selectedTariff =
    data.tariffs.find((t) => t.id === tariffId) ?? pickDefaultTariff(data.tariffs, data.settings)
  const target = data.settings?.targetHourlyYen ?? null

  const status = active
    ? '🟢 稼働中'
    : awaitingSettle > 0
      ? '📝 精算待ちの記録あり（記録から確定）'
      : todayResult.rows.length > 0
        ? '✅ 今日の記録あり'
        : drafts.length > 0
          ? '📝 帰宅未記録の下書きあり'
          : '⚪ 未開始'

  return (
    <div className="stack">
      <section className="card" aria-labelledby="today-title">
        <h3 id="today-title">今日の状態：{status}</h3>
        {!active ? (
          <button type="button" className="primary" onClick={() => void run(() => departNow(db))}>
            🏠 自宅を出発
          </button>
        ) : (
          <div className="stack">
            <dl className="stats">
              <div><dt>出発から</dt><dd>{formatDuration((Date.parse(now) - Date.parse(active.departedAt)) / 1000)}</dd></div>
              {data.settings?.homeDeadline && <div><dt>帰宅締切</dt><dd>{data.settings.homeDeadline}</dd></div>}
            </dl>
            {openRental ? (
              <RentalStatus rental={openRental} now={now} onReturn={() => void run(() => endRental(db, active.id, openRental.id))} />
            ) : (
              <div className="stack">
                {data.tariffs.length > 0 && (
                  <label className="field">
                    <span>料金</span>
                    <select value={selectedTariff?.id ?? ''} onChange={(e) => setTariffId(e.target.value)}>
                      {data.tariffs.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                {selectedTariff && (
                  <button type="button" onClick={() => void run(() => startRental(db, active.id, selectedTariff))}>
                    🚲 レンタル開始
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              className="primary"
              onClick={() =>
                void run(async () => {
                  await arriveHome(db, active.id)
                  onSettle(active.id)
                })
              }
            >
              🏁 帰宅して精算
            </button>
          </div>
        )}
        <Problems items={problems} />
      </section>

      <section className="card" aria-labelledby="month-title">
        <h3 id="month-title">📅 今月（{today.slice(5, 7).replace(/^0/, '')}月）の成績（税引前）</h3>
        {month.rows.length === 0 && month.totals.costYen === 0 ? (
          <p className="hint">まだ確定した記録がありません。</p>
        ) : (
          <dl className="stats">
            <div><dt>営業純利益</dt><dd className="big">{formatYen(month.totals.operatingProfitYen)}</dd></div>
            <div>
              <dt>営業純時給</dt>
              <dd>
                {month.totals.hourlyYen === null ? '算出不可' : `${formatYen(month.totals.hourlyYen)}/時`}
                {target !== null && month.totals.hourlyYen !== null && (month.totals.hourlyYen >= target ? '（🎯 目標以上）' : '（目標未満）')}
              </dd>
            </div>
            <div><dt>投資配賦後の時給</dt><dd>{month.totals.afterAllocationHourlyYen === null ? '算出不可' : `${formatYen(month.totals.afterAllocationHourlyYen)}/時`}</dd></div>
            <div><dt>稼働</dt><dd>{month.rows.length}回・{month.totals.hours.toFixed(1)}時間</dd></div>
          </dl>
        )}
        {month.excludedDrafts + month.excludedInvalid > 0 && (
          <p className="hint">下書き・要確認の {month.excludedDrafts + month.excludedInvalid} 件は集計に入っていません。</p>
        )}
      </section>
    </div>
  )
}

function RentalStatus({ rental, now, onReturn }: { rental: { tariff: Parameters<typeof calculateRental>[0]['tariff']; tariffName: string; startAt: string | null }; now: string; onReturn: () => void }) {
  const r = calculateRental({ tariff: rental.tariff, startAt: rental.startAt }, now)
  return (
    <div className="subcard stack">
      <dl className="stats">
        <div><dt>レンタル経過</dt><dd>{formatDuration(r.elapsedSeconds ?? 0)}</dd></div>
        <div><dt>見積料金</dt><dd className="big">{formatYen(r.amountYen)}</dd></div>
        <div>
          <dt>次の課金</dt>
          <dd>
            {r.nextIncreaseAt
              ? `${formatClock(r.nextIncreaseAt)}（あと${formatDuration((Date.parse(r.nextIncreaseAt) - Date.parse(now)) / 1000)}）`
              : r.capped
                ? '上限に到達：上限の時間内は追加課金なし'
                : rental.tariff.kind === 'none'
                  ? '貸出ごとの料金なし'
                  : '見積の対象外（実請求額を確認）'}
          </dd>
        </div>
      </dl>
      <p className="hint">{rental.tariffName}。返却時はアプリの請求額が正です。</p>
      <button type="button" onClick={onReturn}>
        🅿️ 返却した
      </button>
    </div>
  )
}
