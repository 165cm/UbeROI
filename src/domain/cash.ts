// 現金払いのお釣り。受け取りそうな額を先に並べ、お釣りと渡すお札・硬貨の内訳を出す
import { assertYen } from './core'

/** 日本の紙幣・硬貨（2000円札は使われにくいので含めない） */
export const DENOMINATIONS = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1] as const

export interface ChangeResult {
  receivedYen: number
  /** お釣り。足りない時は null */
  changeYen: number | null
  /** 足りない額（足りている時は 0） */
  shortYen: number
  /** お釣りの渡し方（大きい順） */
  breakdown: { yen: number; count: number }[]
}

/** お釣りを、少ない枚数で渡す内訳に分ける */
export function changeBreakdown(changeYen: number): { yen: number; count: number }[] {
  assertYen(changeYen, 'お釣り')
  const out: { yen: number; count: number }[] = []
  let rest = changeYen
  for (const yen of DENOMINATIONS) {
    const count = Math.floor(rest / yen)
    if (count > 0) {
      out.push({ yen, count })
      rest -= yen * count
    }
  }
  return out
}

export function calculateChange(totalYen: number, receivedYen: number): ChangeResult {
  assertYen(totalYen, '支払い金額')
  assertYen(receivedYen, '受け取った額')
  if (receivedYen < totalYen) return { receivedYen, changeYen: null, shortYen: totalYen - receivedYen, breakdown: [] }
  const changeYen = receivedYen - totalYen
  return { receivedYen, changeYen, shortYen: 0, breakdown: changeBreakdown(changeYen) }
}

const ceilTo = (yen: number, unit: number) => Math.ceil(yen / unit) * unit

/**
 * お客様が出しそうな額。
 * - ちょうど（お釣りなし）
 * - 100円・500円・1000円単位に切り上げ
 * - 1000円単位に切り上げ＋端数の小銭（お釣りをお札だけにする払い方。例：4,260円 → 5,260円で1,000円のお釣り）
 * - 5000円札・1万円札
 * 支払い金額以上で重ならないものを、小さい順に並べる
 */
export function likelyPayments(totalYen: number): number[] {
  assertYen(totalYen, '支払い金額')
  if (totalYen === 0) return []
  const remainder = totalYen % 1000
  const candidates = [
    totalYen,
    ceilTo(totalYen, 100),
    ceilTo(totalYen, 500),
    ceilTo(totalYen, 1000),
    remainder === 0 ? totalYen : ceilTo(totalYen, 1000) + remainder,
    ceilTo(totalYen, 5000),
    ceilTo(totalYen, 10000),
  ]
  return [...new Set(candidates)].filter((v) => v >= totalYen).sort((a, b) => a - b)
}
