// 持ち帰りコード：Safari で記録したオファーを、ホーム画面のアプリへ移す
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeliKanDB } from './db'
import { decodeOfferTransfer, encodeOfferTransfer } from './offerTransfer'
import { importOffers, saveOffer } from './repo'
import type { OfferRecord } from './schema'

const offer = (id: string, at: string): OfferRecord => ({
  id,
  at,
  payYen: 946,
  minutes: 24,
  km: 3.7,
  town: '高円寺',
  areaName: '中野・荻窪エリア',
  decision: 'accept',
  hourlyYen: 1800,
  outcome: 'accepted',
  createdAt: '2026-10-05T12:00:00.000Z',
  updatedAt: '2026-10-05T12:00:00.000Z',
  revision: 1,
})

let db: DeliKanDB
beforeEach(async () => {
  db = new DeliKanDB(`transfer-${Math.random()}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

describe('持ち帰りコード', () => {
  it('コードにして戻せる。何度取り込んでも同じ記録は重ならない', async () => {
    const offers = [offer('a', '2026-10-05T12:00:00.000Z'), offer('b', '2026-10-05T12:30:00.000Z')]
    const code = encodeOfferTransfer(offers)
    expect(code).toMatch(/^DELIKAN-OFFERS-1:[A-Za-z0-9_-]+$/)
    const decoded = decodeOfferTransfer(`  ${code}\n`)
    expect(decoded?.map((o) => [o.id, o.town, o.outcome])).toEqual([['a', '高円寺', 'accepted'], ['b', '高円寺', 'accepted']])

    await saveOffer(db, offer('a', '2026-10-05T12:00:00.000Z'))
    expect(await importOffers(db, decoded!)).toEqual({ added: 1, skipped: 1 })
    expect(await importOffers(db, decoded!)).toEqual({ added: 0, skipped: 2 })
    expect(await db.offers.count()).toBe(2)
    expect((await db.offers.get('b'))?.createdAt).toBe('2026-10-05T12:00:00.000Z')
  })

  it('壊れたコード・ほかの文字は読まない。値がおかしい記録は1件も取り込まない', async () => {
    expect(decodeOfferTransfer('こんにちは')).toBeNull()
    expect(decodeOfferTransfer('DELIKAN-OFFERS-1:xxxx')).toBeNull()
    const bad = decodeOfferTransfer(encodeOfferTransfer([offer('a', '2026-10-05T12:00:00.000Z'), { ...offer('b', 'きのう'), minutes: 0 }]))!
    await expect(importOffers(db, bad)).rejects.toThrow()
    expect(await db.offers.count()).toBe(0)
  })
})
