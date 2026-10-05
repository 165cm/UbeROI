// オファー判定の「設定コード」。iPhone のショートカットから開くページは Safari で開き、
// ホーム画面のアプリとは保存場所が別になるため、判定に使う設定を URL に入れて渡す（外部へは送らない）
import { isBusynessTable, type BusynessTable } from './busyness'

export interface OfferConfig {
  targetHourlyYen: number | null
  bufferMinutes: number
  minKmYen: number | null
  rentalYenPerMinute: number
  homeDeadline: string | null
  minutesToHome: number
  areas: { name: string; towns: string[]; levels: BusynessTable }[]
  /** 設定コードを作った日（古くなったら作り直しを促す） */
  createdOn: string
}

const VERSION = 1

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(code: string): string {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** 設定を短い文字列にする（表は 168 桁の数字にする） */
export function encodeOfferConfig(c: OfferConfig): string {
  return toBase64Url(
    JSON.stringify({
      v: VERSION,
      t: c.targetHourlyYen,
      b: c.bufferMinutes,
      k: c.minKmYen,
      r: Math.round(c.rentalYenPerMinute * 100) / 100,
      d: c.homeDeadline,
      h: c.minutesToHome,
      a: c.areas.map((a) => ({ n: a.name, t: a.towns, l: a.levels.map((day) => day.join('')).join('') })),
      o: c.createdOn,
    }),
  )
}

const isNum = (v: unknown, min = 0) => typeof v === 'number' && Number.isFinite(v) && v >= min
const isNullableInt = (v: unknown) => v === null || (Number.isSafeInteger(v) && (v as number) >= 0)

/** 設定コードを読む。壊れている・版が違う時は null（推測で埋めない） */
export function decodeOfferConfig(code: string): OfferConfig | null {
  let raw: unknown
  try {
    raw = JSON.parse(fromBase64Url(code))
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (o.v !== VERSION || !isNullableInt(o.t) || !isNum(o.b) || !isNullableInt(o.k) || !isNum(o.r) || !isNum(o.h)) return null
  if (!(o.d === null || (typeof o.d === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.d)))) return null
  if (typeof o.o !== 'string' || !Array.isArray(o.a)) return null
  const areas: OfferConfig['areas'] = []
  for (const a of o.a as unknown[]) {
    if (typeof a !== 'object' || a === null) return null
    const { n, t, l } = a as Record<string, unknown>
    if (typeof n !== 'string' || !Array.isArray(t) || !t.every((x) => typeof x === 'string') || typeof l !== 'string' || !/^[0-4]{168}$/.test(l)) return null
    const levels = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => Number(l[d * 24 + h])))
    if (!isBusynessTable(levels)) return null
    areas.push({ name: n, towns: t as string[], levels })
  }
  return {
    targetHourlyYen: o.t as number | null,
    bufferMinutes: o.b as number,
    minKmYen: o.k as number | null,
    rentalYenPerMinute: o.r as number,
    homeDeadline: o.d as string | null,
    minutesToHome: o.h as number,
    areas,
    createdOn: o.o,
  }
}
