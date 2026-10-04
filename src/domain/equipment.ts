// 装備プラン（初級・中級・上級の比較）。プランは計画であり、実績（購入済みの装備）を変えない
import { assertYen } from './core'

export type EquipmentCategory =
  | 'vehicle'
  | 'bag'
  | 'helmet'
  | 'mount'
  | 'battery'
  | 'rainwear'
  | 'visibility'
  | 'other'

export interface PlanItemInput {
  label: string
  category: EquipmentCategory
  /** null は価格未設定（0円の無料とは区別する） */
  unitYen: number | null
  quantity: number
  /** 予定・購入済み・前から持っている */
  state: 'planned' | 'purchased' | 'owned'
}

export interface PlanSummary {
  /** 価格が分かっている品目のセット総額 */
  totalYen: number
  /** これから買うのに必要な現金（予定の品目のみ） */
  cashNeededYen: number
  /** 前から持っている品目の額 */
  ownedYen: number
  /** 価格未設定の品目数（総額に含めていない） */
  unpricedCount: number
}

export function summarizePlan(items: readonly PlanItemInput[]): PlanSummary {
  let totalYen = 0
  let cashNeededYen = 0
  let ownedYen = 0
  let unpricedCount = 0
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new RangeError('数量は1以上です')
    if (item.unitYen === null) {
      unpricedCount++
      continue
    }
    assertYen(item.unitYen, '価格')
    const amount = item.unitYen * item.quantity
    if (!Number.isSafeInteger(amount)) throw new RangeError('金額が大きすぎます')
    totalYen += amount
    if (item.state === 'planned') cashNeededYen += amount
    if (item.state === 'owned') ownedYen += amount
  }
  return { totalYen, cashNeededYen, ownedYen, unpricedCount }
}
