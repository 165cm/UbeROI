import { assertYen, type Platform } from '../domain'
import { PLATFORM_LABELS, type ServiceRevenue, type SessionRecord } from './schema'

/** 既存の単一サービスを先頭に保ち、追加分だけを別に保存する。 */
export function serviceRevenues(s: SessionRecord): ServiceRevenue[] {
  const seen = new Set<string>()
  const unique = s.adjustments.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true })
  return [{ platform: s.platform, baseYen: s.baseYen, tipsYen: s.tipsYen,
    bonusYen: unique.filter(a => a.kind === 'quest').reduce((n, a) => n + a.amountYen, 0),
    adjustmentYen: unique.filter(a => a.kind === 'other').reduce((n, a) => n + a.amountYen, 0),
    completedCount: s.completedCount }, ...(s.additionalServices ?? [])]
}

export function serviceLabel(s: SessionRecord): string {
  return serviceRevenues(s).map(r => r.platform).sort().map(p => PLATFORM_LABELS[p]).join(' ＋ ')
}

export function serviceCount(s: SessionRecord, platform?: Platform): number | null {
  const rows = serviceRevenues(s).filter(r => platform === undefined || r.platform === platform)
  return rows.some(r => r.completedCount === null) ? null : rows.reduce((n, r) => n + (r.completedCount ?? 0), 0)
}

export function questSession(s: SessionRecord, platform: Platform) {
  return { status: s.status, returnedAt: s.returnedAt, completedCount: serviceCount(s, platform), eligible: serviceRevenues(s).some(r => r.platform === platform) }
}

export function serviceRevenueYen(r: ServiceRevenue): number {
  const labels = { baseYen: '基本報酬', tipsYen: 'チップ', bonusYen: '確定ボーナス', adjustmentYen: 'その他の調整' }
  for (const key of ['baseYen', 'tipsYen', 'bonusYen', 'adjustmentYen'] as const) assertYen(r[key] ?? 0, `${PLATFORM_LABELS[r.platform]}の${labels[key]}`, { allowNegative: key === 'adjustmentYen' })
  const total = (r.baseYen ?? 0) + (r.tipsYen ?? 0) + (r.bonusYen ?? 0) + (r.adjustmentYen ?? 0)
  assertYen(total, '売上合計', { allowNegative: true })
  return total
}
