// ホームの「💴 お釣り」：現金払いの時に、出されそうな額ごとのお釣りを先に並べる。計算は src/domain/cash.ts
import { useState } from 'react'
import { calculateChange, likelyPayments } from '../domain'
import { IntInput, Tip } from '../components/fields'
import { formatYen } from '../format'

const yenLabel = (yen: number) => (yen >= 1000 ? `${yen / 1000}千円` : `${yen}円`)

function breakdownText(breakdown: { yen: number; count: number }[]): string {
  return breakdown.map((b) => `${yenLabel(b.yen)}×${b.count}`).join('・')
}

export function CashChange({ open = false }: { open?: boolean }) {
  const [totalYen, setTotalYen] = useState<number | null>(null)
  const [receivedYen, setReceivedYen] = useState<number | null>(null)
  const result = totalYen !== null && receivedYen !== null ? calculateChange(totalYen, receivedYen) : null

  return (
    <details className="card fold" open={open || undefined}>
      <summary>
        <strong>💴 お釣り</strong>
        <span className="hint">{totalYen === null ? '現金払いの時に' : `支払い ${formatYen(totalYen)}`}</span>
      </summary>
      <div className="stack">
        <div className="row">
          <IntInput
            label="支払い金額"
            unit="円"
            value={totalYen}
            onChange={(v) => {
              setTotalYen(v)
              setReceivedYen(null)
            }}
            tip="配達アプリに出ている、お客様の支払い金額"
          />
          <IntInput label="受け取った額" unit="円" value={receivedYen} onChange={setReceivedYen} tip="下の一覧にない額を受け取った時に入れます" />
        </div>
        {result && (
          <p className="decision" role="status">
            {result.changeYen === null ? (
              <strong>⚠️ あと {formatYen(result.shortYen)} 足りません</strong>
            ) : (
              <>
                <strong>お釣り {formatYen(result.changeYen)}</strong>
                {result.breakdown.length > 0 && <span className="hint">（{breakdownText(result.breakdown)}）</span>}
              </>
            )}
          </p>
        )}
        {totalYen !== null && totalYen > 0 && (
          <>
            <div className="line">
              <span className="grow hint">出されそうな額 → お釣り</span>
              <Tip label="出されそうな額">
                ちょうど、100円・500円・1,000円単位に切り上げた額、小銭を足してお札だけのお釣りにする額（例：4,260円に5,260円）、5,000円札・1万円札を並べています。押すと受け取った額に入ります。
              </Tip>
            </div>
            <ul className="list">
              {likelyPayments(totalYen).map((paid) => {
                const r = calculateChange(totalYen, paid)
                return (
                  <li key={paid}>
                    <button type="button" className="list-item cash-row" aria-pressed={receivedYen === paid} onClick={() => setReceivedYen(paid)}>
                      <span className="line">
                        <span className="grow">{formatYen(paid)}</span>
                        <span className="num">→ {r.changeYen === 0 ? 'お釣りなし' : formatYen(r.changeYen)}</span>
                      </span>
                      {r.breakdown.length > 0 && <span className="hint">{breakdownText(r.breakdown)}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </details>
  )
}
