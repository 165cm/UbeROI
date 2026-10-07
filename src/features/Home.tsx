// ホーム（S02）「今日」：今日の稼働（出発からの時計・帰宅予定）・レンタル料金・クエスト・帰宅して精算。そのほかの判断のたすけは折りたたみに
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { averageLevel, breakAdvice, busyAhead, calculateRental, deadlineMs, estimateRevenue, localDate, nextChargeYen, rentalCostByHours, tieredCapInfo, timeSlotOf, type Tariff } from '../domain'
import { CardTitle, IntInput, Problems, Tip, errorMessages } from '../components/fields'
import { formatClock, formatDuration, formatYen } from '../format'
import { useData } from '../storage/context'
import { arriveHome, departNow, endRental, listTariffs, pickDefaultTariff, primaryArea, startRental } from '../storage/repo'
import { pastSessionsFor, periodFor } from '../storage/toDomain'
import type { AreaRecord } from '../storage/schema'
import { BusyMap } from './AreaMap'
import { CashChange } from './CashChange'
import { ContinueCard } from './ContinueCard'
import { OutlookCard, outlookEndAt } from './OutlookCard'
import { loadPrefs } from './ContinueCard'
import { QuestPush } from './QuestPush'
import { QuestCard } from './QuestCard'

const HELPERS_KEY = 'deli-kan:helpers-open'
/** 「📋 判断のたすけ」を開いたままにするか（端末ごとの好み） */
function loadHelpersOpen(): boolean {
  try {
    return localStorage.getItem(HELPERS_KEY) === '1'
  } catch {
    return false
  }
}
function saveHelpersOpen(open: boolean) {
  try {
    localStorage.setItem(HELPERS_KEY, open ? '1' : '0')
  } catch {
    // 覚えられなくても使える
  }
}

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
  const [helpersOpen, setHelpersOpen] = useState(loadHelpersOpen)
  useEffect(() => saveHelpersOpen(helpersOpen), [helpersOpen])

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

  const sessions = pastSessionsFor(data.sessions)
  const rentalForOutlook = openRental && openRental.startAt ? { tariff: openRental.tariff, startAt: openRental.startAt } : null
  const homeDeadline = data.settings?.homeDeadline ?? null
  const endAt = active ? outlookEndAt(active.id, now, homeDeadline, active.departedAt) : null
  const elapsedMinutes = active ? Math.max(0, Math.floor((Date.parse(now) - Date.parse(active.departedAt)) / 60_000)) : 0

  // 案にない判断のたすけは、1つの折りたたみにまとめる（最初は閉じる）
  const helpers = (
    <details className="card fold helpers" open={helpersOpen || undefined} onToggle={(e) => setHelpersOpen(e.currentTarget.open)}>
      <summary>
        <strong>📋 判断のたすけ</strong>
        <span className="hint">{active ? '終了までの見通し・あと少し続ける？・混み具合・今月の成績' : 'お釣り・混み具合・今月の成績'}</span>
      </summary>
      <div className="stack">
        {data.settings?.offerJudgeEnabled && <a className="button-link" href="#offer">🧾 オファー判定</a>}
        {active && (
          <>
            <OutlookCard
              now={now}
              sessionId={active.id}
              departedAt={active.departedAt}
              rental={rentalForOutlook}
              past={sessions}
              busyness={area?.levels ?? null}
              offers={data.offers}
              allOffers={data.offers}
              targetHourlyYen={target}
              homeDeadline={homeDeadline}
              moveAreas={data.areas.filter((a) => area && a.id !== area.id && a.moveMinutes && a.moveFromAreaId === area.id).map((a) => ({ name: a.name, minutes: a.moveMinutes!, levels: a.levels }))}
            />
            <ContinueCard now={now} departedAt={active.departedAt} rental={rentalForOutlook} past={sessions} targetHourlyYen={target} homeDeadline={homeDeadline} busyness={area?.levels ?? null} />
          </>
        )}
        {!active && <CashChange />}
        {data.areas.length > 0 && <section className="card"><h3>エリアの傾向</h3><p className="hint">登録した時間帯の傾向です。現在の注文状況ではありません。</p><BusyAhead areas={data.areas} primaryId={area?.id ?? null} now={now} /></section>}
        {active && <QuestCard now={now} />}
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
    </details>
  )

  return (
    <div className="stack home">
      <section className="card today-card" aria-labelledby="today-title">
        <h3 id="today-title" className="today-title">
          <span className="grow">今日の稼働</span>
          {active ? <span className="pill working-pill">稼働中</span> : <span className="hint">{status}</span>}
        </h3>

        {!active ? (
          <button type="button" className="primary" onClick={() => void run(() => departNow(db))}>
            自宅を出発
          </button>
        ) : (
          <div className="today-clock">
            <div>
              <span className="label">出発から</span>
              <strong className="clock num" aria-label={`出発から${Math.floor(elapsedMinutes / 60)}時間${elapsedMinutes % 60}分`}>
                {pad2(Math.floor(elapsedMinutes / 60))}:{pad2(elapsedMinutes % 60)}
              </strong>
            </div>
            <div className="today-return">
              <span className="label">帰宅予定</span>
              <strong className="num">{endAt ? formatClock(endAt).slice(0, 5) : '—'}</strong>
            </div>
          </div>
        )}
        <Problems items={problems} />
      </section>

      {active && (openRental ? (
        <RentalStatus rental={openRental} now={now} onReturn={() => void run(() => endRental(db, active.id, openRental.id))} />
      ) : (
        selectedTariff && (
          <section className="card stack" aria-label="レンタル">
            <div className="line">
              {data.tariffs.length > 1 && (
                <select className="grow" aria-label="料金" value={selectedTariff.id} onChange={(e) => setTariffId(e.target.value)}>
                  {data.tariffs.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
              <button type="button" className={data.tariffs.length > 1 ? 'main-action grow' : 'main-action'} onClick={() => void run(() => startRental(db, active.id, selectedTariff))}>
                レンタル開始
              </button>
            </div>
          </section>
        )
      ))}

      {active && endAt && (
        <QuestPush
          now={`${now.slice(0, 16)}:00.000Z`}
          sessionId={active.id}
          departedAt={active.departedAt}
          platform={active.platform}
          acceptedOffers={data.offers.filter((o) => o.outcome === 'accepted' && o.at >= active.departedAt).length}
          endAt={endAt}
          lastAt={homeDeadline ? new Date(deadlineMs(active.departedAt, homeDeadline) - loadPrefs().minutesToHome * 60_000).toISOString() : null}
          revenuePerHourYen={estimateRevenue(now, new Date(Date.parse(now) + 3_600_000).toISOString(), sessions, area?.levels ?? null).revenueYen}
        />
      )}

      {!active && awaitingSettle > 0 && <section className="card notice-card"><h3>精算待ちが{awaitingSettle}件あります</h3><p>売上と経費を確認すると、実質時給が分かります。</p><a className="button-link" href="#records">未精算の記録を確認</a></section>}
      {!active && data.settings?.weeklyBudgetMinutes == null && <section className="card"><h3>自分に合う働き方を設定</h3><p>働ける時間と料金を決めて、今週の計画を作れます。</p><a className="button-link" href="#plan">働ける条件を設定する</a></section>}
      {!active && <QuestCard now={now} />}

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

      {helpers}

      {active && (
        <div className="settle-bar">
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
            帰宅して精算
          </button>
        </div>
      )}
    </div>
  )
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function RentalStatus({ rental, now, onReturn }: { rental: { tariff: Parameters<typeof calculateRental>[0]['tariff']; tariffName: string; startAt: string | null }; now: string; onReturn: () => void }) {
  const r = calculateRental({ tariff: rental.tariff, startAt: rental.startAt }, now)
  const step = rental.startAt ? nextChargeYen(rental.tariff, rental.startAt, r.nextIncreaseAt, r.amountYen) : null
  const left = r.nextIncreaseAt ? Math.max(0, Math.floor((Date.parse(r.nextIncreaseAt) - Date.parse(now)) / 1000)) : null
  return (
    <section className="card stack rental-status" aria-labelledby="rental-title">
      <div className="line">
        <h3 id="rental-title" className="grow">レンタル料金<span className="hint">（見積）</span></h3>
        <Tip label="レンタル料金">{rental.tariffName}。料金設定からの見積です。返却した時は、シェアサイクルのアプリに出る請求額が正しい額です。</Tip>
      </div>
      <p className="rental-amount num">{r.amountYen === null ? '見積の対象外' : formatYen(r.amountYen)}</p>
      <p className="next-charge line">
        {left !== null ? (
          <>
            <span className="grow">
              ⏱ 次の課金まで <strong className="num">{pad2(Math.floor(left / 60))}:{pad2(left % 60)}</strong>
              <span className="visually-hidden">（{formatClock(r.nextIncreaseAt!)}）</span>
            </span>
            {step !== null && step > 0 && <span>次回 <strong className="num">+{formatYen(step)}</strong></span>}
          </>
        ) : (
          <span className="grow">
            {r.capped ? '上限に到達：上限の時間内は追加課金なし' : rental.tariff.kind === 'none' ? '貸出ごとの料金なし' : '見積の対象外（実請求額を確認）'}
          </span>
        )}
      </p>
      <button type="button" className="main-action outline" onClick={onReturn}>
        ↩ 返却を記録
      </button>
      <details className="rental-details"><summary>料金の上限・乗る長さごとの料金</summary>
      {rental.startAt && rental.tariff.kind === 'tiered' && <CapLine tariff={rental.tariff} startAt={rental.startAt} now={now} />}
      {rental.tariff.kind !== 'none' && <CostByLength tariff={rental.tariff} />}
      </details>
      {/* 休憩の比較は折りたたみの外に置く（昼下がりは自動で開く） */}
      {rental.startAt && rental.tariff.kind !== 'none' && <BreakAdviceBox tariff={rental.tariff} startAt={rental.startAt} now={now} />}
    </section>
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
                      {c.level !== null ? (
                        <span className="ahead-bar" style={{ height: `${c.level * 25}%` }}>
                          <span className="ahead-num">{c.level}</span>
                        </span>
                      ) : (
                        <span className="ahead-num ahead-empty">·</span>
                      )}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MapFold areas={rows.map((r) => r.area)} now={now} />
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

/** 地図の場所を登録したエリアがある時だけ出す。開いた時だけ地図を作る（開かない時は地図の画像を読み込まない） */
function MapFold({ areas, now }: { areas: AreaRecord[]; now: string }) {
  const [open, setOpen] = useState(false)
  const placed = areas
    .filter((a) => a.center && a.radiusM)
    .map((a) => ({ id: a.id, name: a.name, center: a.center!, radiusM: a.radiusM!, levels: a.levels }))
  if (placed.length === 0) return null
  return (
    <details className="map-fold" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>🗺️ 地図で見る（▶ でこの先4時間を動かす）</summary>
      {open && <BusyMap areas={placed} now={now} />}
    </details>
  )
}

/** 上限まであとどれだけか。上限に達した後は、上限で乗れる最後の時刻まで追加の料金がかからない */
function CapLine({ tariff, startAt, now }: { tariff: Extract<Tariff, { kind: 'tiered' }>; startAt: string; now: string }) {
  const cap = tieredCapInfo(tariff)
  if (!cap) return null
  const start = Date.parse(startAt)
  const elapsed = (Date.parse(now) - start) / 1000
  const reachAt = new Date(start + cap.reachesCapAtSeconds * 1000).toISOString()
  const untilAt = new Date(start + cap.coversUntilSeconds * 1000).toISOString()
  if (elapsed >= cap.coversUntilSeconds) return null
  const capped = elapsed >= cap.reachesCapAtSeconds
  return (
    // 残り時間は毎秒変わるので、読み上げの自動通知（role=status）にはしない
    <p className={`cap-line${capped ? ' capped' : ''}`}>
      {capped ? (
        <>
          🎉 上限 {formatYen(cap.capYen)} に到達。<strong>{formatClock(untilAt).slice(0, 5)}</strong> まで追加 0円（あと{formatDuration(cap.coversUntilSeconds - elapsed)}）
        </>
      ) : (
        <>
          上限 {formatYen(cap.capYen)} まで あと<strong>{formatDuration(cap.reachesCapAtSeconds - elapsed)}</strong>（{formatClock(reachAt).slice(0, 5)}）。そこから {formatClock(untilAt).slice(0, 5)} までは追加 0円
        </>
      )}
    </p>
  )
}

/** 乗る長さごとのレンタル代。上限があると、長く乗るほど1時間あたりが下がる */
function CostByLength({ tariff }: { tariff: Tariff }) {
  const rows = rentalCostByHours(tariff, [1, 2, 3, 4, 5, 6, 8])
  const best = rows.filter((r) => r.perHourYen !== null).reduce<(typeof rows)[number] | null>((a, b) => (a === null || b.perHourYen! < a.perHourYen! ? b : a), null)
  return (
    <details>
      <summary>📊 乗る長さとレンタル代（1時間あたり）</summary>
      <div className="stack">
        <div className="table-scroll" tabIndex={0} role="region" aria-label="乗る長さとレンタル代">
          <table className="breakdown">
            <thead>
              <tr><th scope="col">乗る長さ</th><th scope="col">レンタル代</th><th scope="col">1時間あたり</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.hours} className={best?.hours === r.hours ? 'picked' : undefined}>
                  <th scope="row">{r.hours}時間</th>
                  <td>{r.yen === null ? '対象外' : formatYen(r.yen)}</td>
                  <td>{r.perHourYen === null ? '—' : `${formatYen(r.perHourYen)}/時`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          上限のある料金では、1回の貸出で長く乗るほど1時間あたりのレンタル代が下がります。休憩で返して借り直すと、料金は最初から数え直しです。
          電動アシストの電池がどれだけ持つかは車両と走り方しだいなので、上限に達した後に電池が切れそうな時は、返して別の車両を借りる（料金は最初から）か、帰る時間を考えてください。
        </p>
      </div>
    </details>
  )
}
