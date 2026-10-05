// 「持ち帰りコード」：iPhone のショートカットから開いた Safari で記録したオファーを、ホーム画面のアプリへ移すための文字列。
// 端末の中でコピー＆貼り付けするだけで、外部へは送らない。住所は元から保存していない（地名まで）
import { fromBase64Url, toBase64Url } from '../domain'
import type { OfferRecord } from './schema'

const PREFIX = 'DELIKAN-OFFERS-1:'

export function encodeOfferTransfer(offers: readonly OfferRecord[]): string {
  const rows = offers.map((o) => [o.id, o.at, o.payYen, o.minutes, o.km, o.town, o.areaName, o.decision, o.hourlyYen, o.outcome, o.createdAt])
  return PREFIX + toBase64Url(JSON.stringify(rows))
}

const str = (v: unknown) => typeof v === 'string'
const nullableStr = (v: unknown) => v === null || typeof v === 'string'

/** 持ち帰りコードを読む。形が違う・壊れている時は null（細かい値の確かめは取り込む時に行う） */
export function decodeOfferTransfer(code: string): OfferRecord[] | null {
  const text = code.trim()
  if (!text.startsWith(PREFIX)) return null
  let rows: unknown
  try {
    rows = JSON.parse(fromBase64Url(text.slice(PREFIX.length)))
  } catch {
    return null
  }
  if (!Array.isArray(rows)) return null
  const offers: OfferRecord[] = []
  for (const row of rows as unknown[]) {
    if (!Array.isArray(row) || row.length !== 11) return null
    const [id, at, payYen, minutes, km, town, areaName, decision, hourlyYen, outcome, createdAt] = row as unknown[]
    if (!str(id) || !str(at) || typeof payYen !== 'number' || typeof minutes !== 'number' || !(km === null || typeof km === 'number')) return null
    if (!nullableStr(town) || !nullableStr(areaName) || !str(decision) || !(hourlyYen === null || typeof hourlyYen === 'number') || !str(outcome) || !str(createdAt)) return null
    offers.push({
      id: id as string,
      at: at as string,
      payYen,
      minutes,
      km: km as number | null,
      town: town as string | null,
      areaName: areaName as string | null,
      decision: decision as OfferRecord['decision'],
      hourlyYen: hourlyYen as number | null,
      outcome: outcome as OfferRecord['outcome'],
      createdAt: createdAt as string,
      updatedAt: '',
      revision: 0,
    })
  }
  return offers
}
