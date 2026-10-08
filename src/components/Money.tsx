import { formatYen } from '../format'

/** 数字を主役に、通貨記号は小さく。読み上げでは従来どおり「円」と読む。 */
export function Money({ value }: { value: number | null }) {
  if (value === null) return <>算出不可</>
  const rounded = Math.round(value)
  return <span className="money"><span aria-hidden="true">{rounded < 0 && '−'}<small>¥</small>{Math.abs(rounded).toLocaleString('ja-JP')}</span><span className="visually-hidden">{formatYen(value)}</span></span>
}
