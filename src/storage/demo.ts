// デモ用の合成データ。実配達の記録ではない。デモ用データベースにだけ入れる
import type { DeliKanDB } from './db'
import { emptySession, newId } from './repo'
import type { SessionRecord } from './schema'

export async function seedDemo(db: DeliKanDB): Promise<void> {
  if ((await db.sessions.count()) > 0) return
  const tariff = (await db.tariffs.toArray()).find((t) => t.tariff.kind === 'tiered')
  const now = new Date()
  const sessions: SessionRecord[] = [
    { daysAgo: 1, startHour: 17, hours: 4, base: 7200, tips: 300, quest: 600, count: 11, weather: 'light_rain' as const },
    { daysAgo: 3, startHour: 11, hours: 3, base: 4800, tips: 0, quest: 0, count: 8, weather: 'clear' as const },
    { daysAgo: 6, startHour: 18, hours: 3, base: 5600, tips: 150, quest: 400, count: 9, weather: 'cloudy' as const },
  ].map((d) => {
    const departed = new Date(now)
    departed.setDate(departed.getDate() - d.daysAgo)
    departed.setHours(d.startHour, 0, 0, 0)
    const returned = new Date(departed.getTime() + d.hours * 3_600_000)
    const now2 = new Date().toISOString()
    return {
      ...emptySession(departed.toISOString(), 'completed'),
      returnedAt: returned.toISOString(),
      weather: d.weather,
      areaLabel: 'サンプルエリア',
      baseYen: d.base,
      tipsYen: d.tips,
      completedCount: d.count,
      adjustments: d.quest ? [{ id: newId(), kind: 'quest' as const, amountYen: d.quest }] : [],
      summaryOnlineSeconds: Math.round(d.hours * 0.85 * 3600),
      rentals: tariff
        ? [{ id: newId(), tariffName: tariff.name, tariff: tariff.tariff, startAt: departed.toISOString(), endAt: returned.toISOString(), billedYen: null }]
        : [],
      note: 'デモ用の合成データ',
      createdAt: now2,
      updatedAt: now2,
      revision: 1,
    }
  })
  await db.sessions.bulkAdd(sessions)
}
