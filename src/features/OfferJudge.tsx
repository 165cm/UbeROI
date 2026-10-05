// オファー判定（#offer）。iPhone のショートカットが読み取った画面の文字（text=）と設定コード（cfg=）を受け取り、
// 実質時給・届け先の混み具合・帰宅締切で ✅/⚠️/❌ を出す。承諾は利用者が配達アプリで自分で押す
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  OFFER_DECISION_LABELS,
  TIME_BANDS,
  TOWN_LEARNING_MIN_SAMPLES,
  decodeOfferConfig,
  encodeOfferConfig,
  evaluateOffer,
  findTown,
  learnTownRatings,
  mergeTownRatings,
  learnedRatingAt,
  parseOfferText,
  rentalYenPerMinute,
  type BusynessTable,
  type OfferConfig,
  type OfferDecision,
  type TownRating,
} from '../domain'
import { CardTitle, Field, IntInput, Notice, Problems, TextInput, Tip, errorMessages, localToday } from '../components/fields'
import { formatYen } from '../format'
import { useData } from '../storage/context'
import { DEFAULT_OFFER_BUFFER_MINUTES, importOffers, listTariffs, newId, pickDefaultTariff, primaryArea, saveOffer, saveSettings } from '../storage/repo'
import { decodeOfferTransfer, encodeOfferTransfer } from '../storage/offerTransfer'
import type { OfferRecord } from '../storage/schema'
import { loadPrefs } from './ContinueCard'

const APP_URL = 'https://165cm.github.io/UbeROI/'
const DECISION_CLASS: Record<OfferDecision, string> = { accept: 'decision-go', maybe: 'decision-wait', decline: 'decision-stop' }
const LEVEL_WORDS = ['', '空き', 'やや空き', 'やや混む', '混む'] as const

function hashParams(): URLSearchParams {
  const hash = window.location.hash
  const q = hash.indexOf('?')
  return new URLSearchParams(q >= 0 ? hash.slice(q + 1) : '')
}

/** km は小数も受け付ける（空欄は null） */
function KmInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value))
  return (
    <Field label="距離">
      {(id, describedBy) => (
        <div className="input-unit">
          <input
            id={id}
            aria-describedby={describedBy}
            inputMode="decimal"
            value={text}
            placeholder="未設定"
            onChange={(e) => {
              const raw = e.target.value.replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)))
              setText(raw)
              const n = Number(raw)
              onChange(raw === '' || !Number.isFinite(n) || n < 0 ? null : n)
            }}
          />
          <span aria-hidden="true">km</span>
        </div>
      )}
    </Field>
  )
}

export function OfferJudge() {
  const { db } = useData()
  const data = useLiveQuery(async () => ({
    settings: await db.settings.get('settings'),
    areas: await db.areas.toArray(),
    tariffs: await listTariffs(db),
    active: (await db.sessions.toArray()).find((s) => s.status === 'active'),
    offers: await db.offers.orderBy('at').toArray(),
  }), [db])
  const params = useMemo(hashParams, [])
  const fromCode = useMemo(() => {
    const cfg = params.get('cfg')
    return cfg ? decodeOfferConfig(cfg) : null
  }, [params])
  const [text, setText] = useState(params.get('text') ?? '')
  const parsed = useMemo(() => parseOfferText(text), [text])
  const num = (key: string) => {
    const v = params.get(key)
    return v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
  }
  const [payYen, setPayYen] = useState<number | null>(num('pay') ?? parsed.payYen)
  const [minutes, setMinutes] = useState<number | null>(num('min') ?? parsed.minutes)
  const [km, setKm] = useState<number | null>(num('km') ?? parsed.km)
  const [areaChoice, setAreaChoice] = useState<string>('')
  const [notice, setNotice] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])

  // 読み取った文字（届け先の住所を含むことがある）は、取り込んだらすぐ URL から消し、ブラウザーの履歴に残さない
  useEffect(() => {
    const cfg = params.get('cfg')
    if (params.has('text') || params.has('pay') || params.has('min') || params.has('km')) {
      history.replaceState(null, '', `${location.pathname}${location.search}#offer${cfg ? `?cfg=${cfg}` : ''}`)
    }
  }, [params])

  if (!data) return <p className="loading">読み込み中…</p>

  // 判定に使う設定：設定コードがあればそれ（Safari で開いた時）、なければこの端末の設定
  const prefs = loadPrefs()
  const ratings = learnTownRatings(data.offers)
  const defaultTariff = pickDefaultTariff(data.tariffs, data.settings)
  const local: OfferConfig = {
    targetHourlyYen: data.settings?.targetHourlyYen ?? null,
    bufferMinutes: data.settings?.offerBufferMinutes ?? DEFAULT_OFFER_BUFFER_MINUTES,
    minKmYen: data.settings?.offerMinKmYen ?? null,
    rentalYenPerMinute: rentalYenPerMinute(defaultTariff?.tariff),
    homeDeadline: data.settings?.homeDeadline ?? null,
    minutesToHome: prefs.minutesToHome,
    areas: data.areas.map((a) => ({ name: a.name, towns: a.towns, levels: a.levels })),
    primaryAreaName: primaryArea(data.areas, data.settings)?.name ?? null,
    learned: ratings.filter((r) => r.samples >= TOWN_LEARNING_MIN_SAMPLES),
    createdOn: localToday(),
  }
  const config = fromCode ?? local
  const openRental = data.active?.rentals.find((r) => r.startAt && !r.endAt)

  // 届け先のエリア：選んだもの → 文字の中の地名 → 主なエリア（届け先不明）
  const found = findTown(text, config.areas)
  const chosen = config.areas.find((a) => a.name === areaChoice)
  const fallback = config.areas.find((a) => a.name === config.primaryAreaName) ?? (config.areas.length === 1 ? config.areas[0] : undefined)
  const destination: { name: string; levels: BusynessTable; how: string } | null = chosen
    ? { name: chosen.name, levels: chosen.levels, how: '選んだエリア' }
    : found
      ? { name: found.area.name, levels: found.area.levels, how: `地名「${found.town}」から` }
      : fallback
        ? { name: fallback.name, levels: fallback.levels, how: '届け先の地名が見つからないため主なエリア' }
        : null

  const now = new Date().toISOString()
  const ready = payYen !== null && minutes !== null && minutes > 0
  // 地名×時間帯の評価（記録が10件以上たまったもの）。届け先を手で選んだ時は地名が分からないので使わない
  // Safari（設定コード）では、設定コードの評価と、Safari にたまった記録の評価の両方を見る
  const learnedPool = fromCode ? mergeTownRatings(config.learned, ratings) : ratings
  const learned = !chosen && ready ? learnedRatingAt(learnedPool, found?.town ?? null, Date.parse(now) + minutes * 60_000) : null
  let result: ReturnType<typeof evaluateOffer> | null = null
  let calcError: string[] = []
  if (ready) {
    try {
      result = evaluateOffer({
        payYen,
        minutes,
        km,
        at: now,
        bufferMinutes: config.bufferMinutes,
        rental: !fromCode && openRental?.startAt ? { tariff: openRental.tariff, startAt: openRental.startAt } : null,
        rentalYenPerMinute: config.rentalYenPerMinute,
        targetHourlyYen: config.targetHourlyYen,
        minKmYen: config.minKmYen,
        destinationBusyness: destination?.levels ?? null,
        destinationLearned: learned,
        homeDeadline: config.homeDeadline,
        minutesToHome: config.minutesToHome,
        departedAt: fromCode ? null : (data.active?.departedAt ?? null),
      })
    } catch (e) {
      calcError = errorMessages(e)
    }
  }

  const record = async (outcome: 'accepted' | 'declined') => {
    if (!result || payYen === null || minutes === null) return
    setProblems([])
    try {
      await saveOffer(db, {
        id: newId(),
        at: now,
        payYen,
        minutes,
        km,
        town: chosen ? null : (found?.town ?? null),
        areaName: destination && destination.how !== '届け先の地名が見つからないため主なエリア' ? destination.name : null,
        decision: result.decision,
        hourlyYen: result.hourlyYen,
        outcome,
        createdAt: '',
        updatedAt: '',
        revision: 0,
      })
      setNotice(outcome === 'accepted' ? '✅ 「受けた」と記録しました' : '❌ 「断った」と記録しました')
    } catch (e) {
      setProblems(errorMessages(e))
    }
  }

  const shortcutUrl = `${APP_URL}#offer?cfg=${encodeOfferConfig(local)}&text=`

  return (
    <div className="stack">
      {fromCode && (
        <p className="hint">
          ショートカットの設定コード（{fromCode.createdOn} 作成）で判定しています。
          {Date.parse(localToday()) - Date.parse(fromCode.createdOn) > 30 * 86_400_000 && <strong> ⚠️ 30日以上前の設定です。アプリで作り直してください</strong>}
        </p>
      )}
      <section className="card stack" aria-labelledby="offer-title">
        <CardTitle
          id="offer-title"
          tip="報酬から、この案件で増えるレンタル代を引き、オファーの分数に余裕（お店での待ちなど）を足した時間で割った「実質時給」で判定します。届け先のエリアが配達を終える頃に混むなら基準を下げ、空いているなら上げます。帰宅締切を過ぎるなら断ります。承諾は配達アプリで自分で押してください（このアプリは押しません）。"
        >
          🧾 オファー判定
        </CardTitle>
        <div className="row">
          <IntInput label="報酬" unit="円" value={payYen} onChange={setPayYen} />
          <IntInput label="分" unit="分" value={minutes} onChange={setMinutes} />
          <KmInput value={km} onChange={setKm} />
        </div>
        {config.areas.length > 0 && (
          <label className="field">
            <span>届け先のエリア</span>
            <select value={areaChoice} onChange={(e) => setAreaChoice(e.target.value)}>
              <option value="">自動（{destination ? `${destination.name}：${destination.how}` : '不明'}）</option>
              {config.areas.map((a) => (
                <option key={a.name} value={a.name}>{a.name}</option>
              ))}
            </select>
          </label>
        )}
        <Problems items={calcError} />
        {!ready ? (
          <p className="hint">報酬と分を入れると判定します（ショートカットから開くと自動で入ります）</p>
        ) : (
          result && (
            <>
              <p className={`decision ${DECISION_CLASS[result.decision]}`} role="status">
                <strong>{OFFER_DECISION_LABELS[result.decision]}</strong>
                {result.hourlyYen !== null && <span>　実質 {formatYen(result.hourlyYen)}/時</span>}
              </p>
              <ul className="reasons">
                {result.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <dl className="stats">
                <div><dt>分単価</dt><dd>{result.perMinuteYen === null ? '算出不可' : `${result.perMinuteYen}円`}</dd></div>
                <div><dt>km単価</dt><dd>{result.perKmYen === null ? '算出不可' : `${result.perKmYen}円`}</dd></div>
                <div><dt>引くレンタル代</dt><dd>{formatYen(result.rentalYen)}{!fromCode && openRental ? '（貸出中）' : ''}</dd></div>
                <div><dt>基準の時給</dt><dd>{result.thresholdYen === null ? '目標 未設定' : `${formatYen(result.thresholdYen)}/時`}</dd></div>
                <div className="wide">
                  <dt>届け先（配達を終える頃）</dt>
                  <dd>
                    {result.arrivalSource === 'learned' && learned
                      ? `${learned.town}（記録${learned.samples}件）：段階${learned.level} ${LEVEL_WORDS[learned.level]}`
                      : destination
                        ? `${destination.name}：${result.arrivalLevel === null ? '混み具合 未入力' : `段階${result.arrivalLevel} ${LEVEL_WORDS[result.arrivalLevel]}`}`
                        : 'エリア未登録'}
                  </dd>
                </div>
              </dl>
              <div className="actions">
                <button type="button" onClick={() => void record('accepted')}>✅ 受けた</button>
                <button type="button" onClick={() => void record('declined')}>❌ 断った</button>
              </div>
              {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
              <Problems items={problems} />
            </>
          )
        )}
      </section>

      <details className="card fold">
        <summary>
          <strong>📄 読み取った文字</strong>
          <span className="hint">{text ? `${text.length}文字` : 'なし'}</span>
        </summary>
        <div className="stack">
          <label className="field">
            <span>画面の文字（貼り付けても読めます）</span>
            <textarea
              rows={4}
              value={text}
              onChange={(e) => {
                const next = e.target.value
                setText(next)
                const p = parseOfferText(next)
                if (p.payYen !== null) setPayYen(p.payYen)
                if (p.minutes !== null) setMinutes(p.minutes)
                if (p.km !== null) setKm(p.km)
              }}
            />
          </label>
        </div>
      </details>

      {fromCode ? <CarryHome offers={data.offers} /> : <ImportFromSafari />}

      {!fromCode && <TownRatings ratings={ratings} />}

      {!fromCode && <OfferSettings bufferMinutes={local.bufferMinutes} minKmYen={local.minKmYen} />}

      {!fromCode && <ShortcutGuide url={shortcutUrl} />}
    </div>
  )
}

function OfferSettings({ bufferMinutes, minKmYen }: { bufferMinutes: number; minKmYen: number | null }) {
  const { db } = useData()
  const [buffer, setBuffer] = useState<number | null>(bufferMinutes)
  const [minKm, setMinKm] = useState<number | null>(minKmYen)
  const [problems, setProblems] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <details className="card fold">
      <summary>
        <strong>⚙️ 判定の基準</strong>
        <span className="hint">余裕{bufferMinutes}分{minKmYen !== null ? `・km単価${minKmYen}円以上` : ''}</span>
      </summary>
      <div className="stack">
        <div className="row">
          <IntInput label="余裕の分数" unit="分" value={buffer} onChange={setBuffer} tip="オファーの分数に足す時間。お店での待ちや、次の注文が来るまでの間の目安です" />
          <IntInput label="km単価の下限（任意）" unit="円" value={minKm} onChange={setMinKm} tip="下回ったら判定を1段下げます。空欄なら使いません" />
        </div>
        <p className="hint">目標の時給・帰宅締切は「設定 → 基本」、家までの時間は「続ける？帰る？」と同じ値を使います。</p>
        <Problems items={problems} />
        {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
        <button
          type="button"
          className="primary"
          onClick={async () => {
            try {
              await saveSettings(db, { offerBufferMinutes: buffer ?? DEFAULT_OFFER_BUFFER_MINUTES, offerMinKmYen: minKm })
              setProblems([])
              setNotice('💾 保存しました。ショートカットの URL も作り直してください')
            } catch (e) {
              setProblems(errorMessages(e))
            }
          }}
        >
          💾 保存
        </button>
      </div>
    </details>
  )
}

function ShortcutGuide({ url }: { url: string }) {
  const [copied, setCopied] = useState<string | null>(null)
  return (
    <details className="card fold">
      <summary>
        <strong>📲 iPhone のショートカットで使う</strong>
        <span className="hint">オファー画面から1回で判定</span>
      </summary>
      <div className="stack">
        <p className="hint">
          オファーが来た時に、背面を2回たたくと画面の文字を読み取って、この判定が開くようにします。ショートカットは画面の文字を読むだけで、承諾は押しません。
        </p>
        <ol className="steps">
          <li>「ショートカット」アプリを開き、右上の「＋」で新しいショートカットを作る</li>
          <li>「スクリーンショットを撮る」を追加</li>
          <li>「画像からテキストを抽出」を追加（入力：スクリーンショット）</li>
          <li>「URLエンコード」を追加（入力：抽出したテキスト）</li>
          <li>「テキスト」を追加し、下の URL を貼り付け、最後に「URLエンコードされたテキスト」を差し込む</li>
          <li>「URLを開く」を追加（入力：そのテキスト）</li>
          <li>名前を「オファー判定」にして保存</li>
          <li>「設定」→「アクセシビリティ」→「タッチ」→「背面タップ」→「ダブルタップ」で「オファー判定」を選ぶ</li>
        </ol>
        <TextInput label="ショートカットに貼る URL" value={url} onChange={() => undefined} tip="判定に使う設定（目標・余裕・レンタル代・締切・エリア）が入っています。設定を変えたら、ここからコピーし直してショートカットの URL を貼り替えてください" />
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url)
              setCopied('📋 コピーしました')
            } catch {
              setCopied('コピーできませんでした。上の欄を長押しして全選択・コピーしてください')
            }
          }}
        >
          📋 URL をコピー
        </button>
        {copied && <p className="hint" role="status">{copied}</p>}
        <div className="line">
          <span className="grow hint">ショートカットから開くと Safari で開くので、「受けた／断った」の記録はときどきアプリへ持ち帰ってください</span>
          <Tip label="記録の保存場所">
            iPhone では、ショートカットから開いたページは Safari で開き、ホーム画面に追加したアプリとは保存場所が別になります。そのため判定に必要な設定は URL に入れて渡しています。Safari で記録した分は、Safari の判定画面の「📤 アプリへ持ち帰る」でコードをコピーし、ホーム画面のアプリのこの画面の「📥 Safari の記録を取り込む」に貼り付けると1か所にまとまります。
          </Tip>
        </div>
      </div>
    </details>
  )
}

/** Safari（設定コードで開いた時）：ここにたまった記録を、ホーム画面のアプリへ持ち帰るコードにする */
function CarryHome({ offers }: { offers: OfferRecord[] }) {
  const [copied, setCopied] = useState<string | null>(null)
  return (
    <details className="card fold">
      <summary>
        <strong>📤 アプリへ持ち帰る</strong>
        <span className="hint">ここの記録 {offers.length}件</span>
      </summary>
      <div className="stack">
        <p className="hint">
          ここ（Safari）で記録した「受けた／断った」は、ホーム画面のアプリとは別に残っています。コードをコピーして、ホーム画面のアプリの「🧾 オファー判定 → 📥 Safari の記録を取り込む」に貼り付けてください。何度貼っても同じ記録は重なりません。
        </p>
        <button
          type="button"
          disabled={offers.length === 0}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(encodeOfferTransfer(offers))
              setCopied(`📋 ${offers.length}件分のコードをコピーしました`)
            } catch {
              setCopied('コピーできませんでした。もう一度押してください')
            }
          }}
        >
          📋 持ち帰りコードをコピー
        </button>
        {copied && <p className="hint" role="status">{copied}</p>}
      </div>
    </details>
  )
}

/** ホーム画面のアプリ：Safari からの持ち帰りコードを貼り付けて、記録を足す */
function ImportFromSafari() {
  const { db } = useData()
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  return (
    <details className="card fold">
      <summary>
        <strong>📥 Safari の記録を取り込む</strong>
        <span className="hint">持ち帰りコードを貼る</span>
      </summary>
      <div className="stack">
        <label className="field">
          <span>持ち帰りコード</span>
          <textarea rows={3} value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <Problems items={problems} />
        {notice && <Notice message={notice} onClose={() => setNotice(null)} />}
        <button
          type="button"
          className="primary"
          disabled={!code.trim()}
          onClick={async () => {
            setNotice(null)
            const offers = decodeOfferTransfer(code)
            if (!offers) {
              setProblems(['持ち帰りコードを読めません。Safari の「📤 アプリへ持ち帰る」でコピーし直して、全部を貼り付けてください'])
              return
            }
            try {
              const { added, skipped } = await importOffers(db, offers)
              setProblems([])
              setCode('')
              setNotice(`📥 ${added}件を取り込みました${skipped ? `（${skipped}件は取り込み済み）` : ''}`)
            } catch (e) {
              setProblems(errorMessages(e))
            }
          }}
        >
          📥 取り込む
        </button>
      </div>
    </details>
  )
}

/** 記録から学習した地名×時間帯の評価の一覧 */
function TownRatings({ ratings }: { ratings: TownRating[] }) {
  const used = ratings.filter((r) => r.samples >= TOWN_LEARNING_MIN_SAMPLES).length
  return (
    <details className="card fold">
      <summary>
        <strong>🧠 地名の評価（記録から学習）</strong>
        <span className="hint">{ratings.length === 0 ? 'まだ記録なし' : `判定に使用 ${used}／${ratings.length}`}</span>
      </summary>
      <div className="stack">
        <div className="line">
          <span className="grow hint">
            受けた配達を終えてから次のオファーまでの待ち時間を、地名×時間帯ごとに集めます。{TOWN_LEARNING_MIN_SAMPLES}件以上たまると、手で登録した混み具合の代わりに判定に使います
          </span>
          <Tip label="地名の評価の決め方">
            待ち時間の中央値が3分以下なら段階4（混む）、7分以下なら3、12分以下なら2、それより長ければ1（空き）。次のオファーまで60分より空いた時は、休憩・終了とみなして数えません。記録した「受けた／断った」だけを使うので、記録しなかったオファーは数えません。
          </Tip>
        </div>
        {ratings.length > 0 && (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="地名の評価の一覧">
            <table>
              <thead>
                <tr><th>地名</th><th>時間帯</th><th>件数</th><th>待ち</th><th>段階</th></tr>
              </thead>
              <tbody>
                {ratings.map((r) => (
                  <tr key={`${r.town}-${r.band}`}>
                    <td>{r.town}</td>
                    <td>{TIME_BANDS[r.band]!.label}</td>
                    <td className="num">{r.samples}{r.samples >= TOWN_LEARNING_MIN_SAMPLES ? ' ✓' : ''}</td>
                    <td className="num">{r.medianWaitMinutes}分</td>
                    <td className="num">{r.level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  )
}
