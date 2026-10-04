// シェアサイクルの料金チェック：借りた時刻から、今の料金と次に上がる時刻を出す
import { useEffect, useState } from 'react'
import { HELLO_TOKYO_CITY, calculateRental } from '../domain'
import { formatClock, formatDuration, formatYen } from '../format'

const STORAGE_KEY = 'deli-kan:rental-start'

// 端末の保存領域が使えない環境（プライベートブラウズ等）でも画面は動かす
function loadStart(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function saveStart(value: string | null): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 保存できなくても、この画面を開いている間は使える
  }
}

export function RentalChecker() {
  const [startAt, setStartAt] = useState<string | null>(loadStart)
  const [now, setNow] = useState(() => new Date().toISOString())

  // 経過時間はタイマーの回数ではなく、開始時刻との差で毎回計算する（再読み込みしても正しい）
  useEffect(() => {
    if (!startAt) return
    const id = window.setInterval(() => setNow(new Date().toISOString()), 1000)
    return () => window.clearInterval(id)
  }, [startAt])

  const start = () => {
    const iso = new Date().toISOString()
    setStartAt(iso)
    setNow(iso)
    saveStart(iso)
  }
  const reset = () => {
    setStartAt(null)
    saveStart(null)
  }

  const result = startAt ? calculateRental({ tariff: HELLO_TOKYO_CITY, startAt }, now) : null

  return (
    <section className="card" aria-labelledby="rental-title">
      <h3 id="rental-title">🚲 シェアサイクル料金（見積）</h3>
      {!result ? (
        <>
          <p className="hint">借りた時に押すと、今の料金と次に料金が上がる時刻が分かります。</p>
          <button type="button" className="primary" onClick={start}>
            今レンタル開始
          </button>
        </>
      ) : (
        <>
          <dl className="stats">
            <div>
              <dt>経過</dt>
              <dd>{formatDuration(result.elapsedSeconds ?? 0)}</dd>
            </div>
            <div>
              <dt>見積料金</dt>
              <dd className="big">{formatYen(result.amountYen)}</dd>
            </div>
            <div>
              <dt>次の課金</dt>
              <dd>
                {result.nextIncreaseAt
                  ? `${formatClock(result.nextIncreaseAt)}（あと${formatDuration((Date.parse(result.nextIncreaseAt) - Date.parse(now)) / 1000)}）`
                  : result.capped
                    ? '上限に到達：上限の時間内は追加課金なし'
                    : '見積の対象外（実請求額を確認）'}
              </dd>
            </div>
          </dl>
          <p className="hint">
            料金の例：HELLO CYCLING 東京都（最初の30分160円、以後15分ごと160円、12時間まで上限2,500円・2026-10確認）。地域・事業者で違うので、設定画面で選べるようにします。返却時はアプリの請求額が正です。
          </p>
          <button type="button" onClick={reset}>
            返却した（リセット）
          </button>
        </>
      )}
    </section>
  )
}
