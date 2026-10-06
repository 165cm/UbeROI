// ホーム（S02）：今日の状態・稼働中のレンタル料金・今月の成績
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { averageLevel, breakAdvice, busyAhead, calculateRental, localDate, timeSlotOf, type Tariff } from '../domain'
import { CardTitle, IntInput, Problems, Tip, errorMessages } from '../components/fields'
import { formatClock, formatDuration, formatYen } from '../format'
import { useData } from '../storage/context'
import { arriveHome, departNow, endRental, listTariffs, pickDefaultTariff, primaryArea, startRental } from '../storage/repo'
import { pastSessionsFor, periodFor } from '../storage/toDomain'
import type { AreaRecord } from '../storage/schema'
import { CashChange } from './CashChange'
import { ContinueCard } from './ContinueCard'
import { OutlookCard } from './OutlookCard'
import { QuestCard } from './QuestCard'

function useNow(active: boolean): string {
  const [now, setNow] = useState(() => new Date().toISOString())
  // 経過時間はタイマーの回数ではなく、保存した開始日時との差で毎回計算する（再読み込み・休止後も正しい）
  // 稼働中は1秒ごと、そうでない時も1分ごとに進める（クエストの期間の切り替わりなどに追いつくため）
  useEffect(() => {
    setNow(new Date().toISOString())
    const id = window.setInterval(() => setNow(new Date().toISOString()), active ? 1000 : 60_000)
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
    areas: await db.areas.toArray(),
    offers: await db.offers.orderBy('at').toArray(),
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
  const area = primaryArea(data.areas, data.settings)
  // 確定した記録があるのに、7日以上バックアップしていなければ声をかける
  const lastBackup = data.settings?.lastBackupAt
  const backupAgeDays = lastBackup ? Math.floor((Date.parse(now) - Date.parse(lastBackup)) / 86_400_000) : null
  const needsBackup = data.sessions.some((s) => s.status === 'completed') && (backupAgeDays === null || backupAgeDays >= 7)

  const status = active
    ? '🟢 稼働中'
    : awaitingSettle > 0
      ? '📝 精算待ちあり（記録から確定）'
      : todayResult.rows.length > 0
        ? '✅ 今日の記録あり'
        : drafts.length > 0
          ? '📝 帰宅未記録の下書きあり'
          : '⚪ 未開始'

  return (
    <div className="stack">
      <section className="card" aria-labelledby="today-title">
        <h3 id="today-title">今日の状態：{status}</h3>
        <BusyAhead areas={data.areas} primaryId={area?.id ?? null} now={now} />
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
              selectedTariff && (
                <div className="line">
                  {data.tariffs.length > 1 && (
                    <select className="grow" aria-label="料金" value={selectedTariff.id} onChange={(e) => setTariffId(e.target.value)}>
                      {data.tariffs.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  )}
                  <button type="button" className={data.tariffs.length > 1 ? 'grow' : undefined} onClick={() => void run(() => startRental(db, active.id, selectedTariff))}>
                    🚲 レンタル開始
                  </button>
                </div>
              )
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
        {data.settings?.offerJudgeEnabled && <a className="button-link" href="#offer">🧾 オファー判定</a>}
      </section>

      {active && (
        <OutlookCard
          now={now}
          sessionId={active.id}
          departedAt={active.departedAt}
          rental={openRental && openRental.startAt ? { tariff: openRental.tariff, startAt: openRental.startAt } : null}
          past={pastSessionsFor(data.sessions)}
          busyness={area?.levels ?? null}
          offers={data.offers}
          allOffers={data.offers}
          targetHourlyYen={target}
          homeDeadline={data.settings?.homeDeadline ?? null}
          moveAreas={data.areas.filter((a) => area && a.id !== area.id && a.moveMinutes && a.moveFromAreaId === area.id).map((a) => ({ name: a.name, minutes: a.moveMinutes!, levels: a.levels }))}
        />
      )}

      {active && (
        <ContinueCard
          now={now}
          departedAt={active.departedAt}
          rental={openRental && openRental.startAt ? { tariff: openRental.tariff, startAt: openRental.startAt } : null}
          past={pastSessionsFor(data.sessions)}
          targetHourlyYen={target}
          homeDeadline={data.settings?.homeDeadline ?? null}
          busyness={area?.levels ?? null}
        />
      )}

      <CashChange />

      <QuestCard now={now} />

      {needsBackup && (
        <section className="card notice-card line" role="status">
          <span className="grow">
            <strong>💾 バックアップしましょう</strong>
            <span className="hint">
              {' '}
              {data.settings?.lastBackupAt ? `前回から${backupAgeDays}日` : '未実施'}・設定 → データ
            </span>
          </span>
          <Tip label="バックアップ">記録はこの端末の中だけにあります。機種変更やブラウザーのデータ削除で消えるので、「設定 → データ」から書き出して、クラウドやパソコンにも残してください。</Tip>
        </section>
      )}

      <section className="card" aria-labelledby="month-title">
        <CardTitle id="month-title" tip="税引前。営業純時給＝営業純利益 ÷ 出発〜帰宅の時間。投資配賦後は、装備・車両の購入額を月ごとに配った額も引いた時給です。">
          📅 {today.slice(5, 7).replace(/^0/, '')}月の成績
        </CardTitle>
        {month.rows.length === 0 && month.totals.costYen === 0 ? (
          <p className="hint">まだ確定した記録がありません。</p>
        ) : (
          <dl className="stats">
            <div><dt>営業純利益</dt><dd className="big">{formatYen(month.totals.operatingProfitYen)}</dd></div>
            <div>
              <dt>営業純時給</dt>
              <dd>
                {month.totals.hourlyYen === null ? '算出不可' : `${formatYen(month.totals.hourlyYen)}/時`}
                {target !== null && month.totals.hourlyYen !== null && (month.totals.hourlyYen >= target ? ' 🎯' : '（目標未満）')}
              </dd>
            </div>
            <div><dt>投資配賦後の時給</dt><dd>{month.totals.afterAllocationHourlyYen === null ? '算出不可' : `${formatYen(month.totals.afterAllocationHourlyYen)}/時`}</dd></div>
            <div><dt>稼働</dt><dd>{month.rows.length}回・{month.totals.hours.toFixed(1)}時間</dd></div>
          </dl>
        )}
        {month.excludedDrafts + month.excludedInvalid > 0 && (
          <p className="hint">⚠️ 下書き・要確認の{month.excludedDrafts + month.excludedInvalid}件は集計外</p>
        )}
      </section>
    </div>
  )
}

function RentalStatus({ rental, now, onReturn }: { rental: { tariff: Parameters<typeof calculateRental>[0]['tariff']; tariffName: string; startAt: string | null }; now: string; onReturn: () => void }) {
  const r = calculateRental({ tariff: rental.tariff, startAt: rental.startAt }, now)
  return (
    <div className="subcard stack">
      <div className="line">
        <span className="grow hint">🚲 {rental.tariffName}</span>
        <Tip label="レンタル料金">料金設定からの見積です。返却した時は、シェアサイクルのアプリに出る請求額が正しい額です。</Tip>
      </div>
      <dl className="stats">
        <div><dt>レンタル経過</dt><dd>{formatDuration(r.elapsedSeconds ?? 0)}</dd></div>
        <div><dt>見積料金</dt><dd className="big">{formatYen(r.amountYen)}</dd></div>
        <div className="wide">
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
      {rental.startAt && rental.tariff.kind !== 'none' && <BreakAdviceBox tariff={rental.tariff} startAt={rental.startAt} now={now} />}
      <button type="button" onClick={onReturn}>
        🅿️ 返却した
      </button>
    </div>
  )
}

/** 休憩する前に返したほうが安いか（今までの料金はどちらでも同じなので比べない） */
function BreakAdviceBox({ tariff, startAt, now }: { tariff: Tariff; startAt: string; now: string }) {
  const [breakMinutes, setBreakMinutes] = useState(60)
  const [afterMinutes, setAfterMinutes] = useState(120)
  const advice = breakAdvice(tariff, startAt, now, breakMinutes, afterMinutes)
  const idle = timeSlotOf(now) === 'idle'
  return (
    <details open={idle}>
      <summary>☕ 休憩するなら{idle ? '（昼下がりは注文が少なめ）' : ''}</summary>
      <div className="stack">
        <div className="row">
          <IntInput label="休憩" unit="分" value={breakMinutes} onChange={(v) => setBreakMinutes(v ?? 0)} />
          <IntInput label="休憩のあと乗る" unit="分" value={afterMinutes} onChange={(v) => setAfterMinutes(v ?? 0)} />
        </div>
        {advice.savingYen === null ? (
          <p className="hint">料金の見積の対象外のため比べられません。</p>
        ) : (
          <p role="status">
            {advice.savingYen > 0
              ? `🅿️ 今返して休憩のあと借り直すと ${formatYen(advice.savingYen)} 安くなります`
              : advice.savingYen < 0
                ? `🚲 借りたまま休憩したほうが ${formatYen(-advice.savingYen)} 安くなります（上限料金に近いため）`
                : '返しても借りたままでも同じ料金です'}
          </p>
        )}
        <div className="line">
          <span className="grow hint">今から：借りたまま {formatYen(advice.keepYen)}／返して借り直す {formatYen(advice.returnAndReRentYen)}</span>
          <Tip label="休憩前の返却">今からかかる料金の比較です（今までの料金はどちらでも同じなので比べません）。返す場所・借りる場所に空きがあるかは公式アプリで確かめてください。</Tip>
        </div>
      </div>
    </details>
  )
}

const BUSY_WORDS = ['', '空き', 'やや空き', 'やや混む', '混む'] as const

/** 主なエリアの、今と1時間後の混み具合（配達アプリの傾向を写したもの） */
/**
 * 登録したエリアの「この先4時間」の混み具合を並べる（主なエリアが先頭）。
 * 段階はそれぞれのエリアの中での比べっこなので、エリア同士の比較は目安
 */
function BusyAhead({ areas, primaryId, now }: { areas: AreaRecord[]; primaryId: string | null; now: string }) {
  const t = Date.parse(now)
  const rows = [...areas]
    .sort((a, b) => Number(b.id === primaryId) - Number(a.id === primaryId) || a.name.localeCompare(b.name, 'ja'))
    .map((a) => {
      const cells = busyAhead(a.levels, t)
      // 4時間分がそろったエリアだけを比べる（未入力を除いた平均では、1枠だけ入力したエリアが有利になるため）
      const complete = cells.every((c) => c.level !== null)
      return { area: a, cells, complete, average: complete ? averageLevel(cells.map((c) => c.level)) : null }
    })
  // 登録したエリアは、この先4時間が未入力でも行を残す（すべて未入力の時だけ表を出さない）
  if (rows.length === 0 || rows.every((r) => r.cells.every((c) => c.level === null))) return null
  const hours = rows[0]!.cells.map((c) => new Date(c.startMs + 9 * 3_600_000).getUTCHours())
  const comparable = rows.filter((r) => r.complete)
  const best = rows.length > 1 && comparable.length > 0 ? comparable.reduce((a, b) => (b.average! > a.average! ? b : a)) : null
  const skipped = rows.length > 1 ? rows.filter((r) => !r.complete).length : 0
  return (
    <div className="busy-ahead">
      <div className="table-scroll" tabIndex={0} role="region" aria-label="この先4時間の混み具合">
        <table>
          <thead>
            <tr>
              <th scope="col">📈 エリア</th>
              {hours.map((h, i) => (
                <th key={h} scope="col">{i === 0 ? `今 ${h}時` : `${h}時`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ area, cells }) => (
              <tr key={area.id} className={best?.area.id === area.id ? 'best' : undefined}>
                <th scope="row">
                  {area.name}
                  {area.id !== primaryId && area.moveMinutes && area.moveFromAreaId === primaryId ? <span className="hint">移動{area.moveMinutes}分</span> : null}
                </th>
                {cells.map((c) => (
                  <td key={c.startMs} aria-label={c.level === null ? '未入力' : `段階${c.level} ${BUSY_WORDS[c.level]}`}>
                    <span className={`ahead-cell level-${c.level ?? 0}`} aria-hidden="true">
                      <span className="ahead-bar" style={{ height: `${(c.level ?? 0) * 25}%` }} />
                      <span className="ahead-num">{c.level ?? '·'}</span>
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(best || skipped > 0) && (
        <p className="hint" role="status">
          {best && (
            <>
              4時間の平均で一番混むのは <strong>{best.area.name}</strong>（{best.average}）。段階はエリアごとの比べっこなので目安です。
            </>
          )}
          {skipped > 0 && `未入力のマスがあるエリア（${skipped}つ）は比べていません。`}
        </p>
      )}
    </div>
  )
}
