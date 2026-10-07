// 週の作戦エンジン（docs/spec/docs/02-profitability.md §5.12）。
// 稼げる日に長く1回（または昼と夜の2回）借りて働く組み合わせを、天気・混み具合・レンタルの上限・クエストの段階から選ぶ。
// 日ごとの候補（シフト）を作り、(時間, 件数) が同じなら利益が一番のものだけ残し、動的計画法で週の残り時間の中の最良を出す
import { parseInstant } from './core'
import { tierGains, type QuestTier } from './quest'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const JST = 9 * HOUR

/** 昼と夜の境（日本時間）。2回に分ける時は、1回目がこの時刻までに終わり、2回目がこの時刻から始まる */
export const SPLIT_HOUR = 16
/** 1回のシフトの最短（時間） */
export const MIN_SHIFT_HOURS = 2
/** 日をまたぐクエスト（作戦の軸＝日跨ぎ）とみなす1回の長さ（時間）。これより短いのはピーク */
export const MAIN_QUEST_MIN_HOURS = 12
/** 1日の最長（時間）の既定 */
export const DEFAULT_MAX_DAY_HOURS = 10

export interface HourValue {
  revenueYen: number
  orders: number
}

export interface PlannerQuest {
  startsAt: string
  endsAt: string
  rewardMode: 'cumulative' | 'incremental'
  tiers: readonly QuestTier[]
  /** 今の件数（調整込み） */
  count: number
}

export interface PlannerInput {
  now: string
  /** 計画する範囲（表示している週。4時区切り） */
  from: string
  to: string
  /** その正時からの1時間の見込み。働けない時間（働ける時間の外・荒天・帰宅締切の後など）は null */
  hour: (startMs: number) => HourValue | null
  /** レンタル代（借りている秒数から）。null なら料金なし */
  rentalFee: ((seconds: number) => number | null) | null
  maxDayHours: number
  /** 週に使える残りの時間（上限−実績）。null は上限なし */
  budgetHours: number | null
  /** すでに選んだ候補枠（その日はこの枠で固定する） */
  fixed: readonly { startsAt: string; endsAt: string }[]
  /** 作戦の軸のクエスト（日跨ぎ）。件数は計画の期間の中の配達を数える */
  quest: PlannerQuest | null
  /** 同じサービスの短いクエスト（ピーク） */
  peaks: readonly PlannerQuest[]
  /** リーダーボードで攻める目標（§5.13）：日跨ぎと同じ数え方の件数。賞金は届くか分からないので、利益には入れず添えるだけ */
  attack?: { rank: number; count: number; prizeYen: number } | null
  targetHourlyYen: number | null
}

export interface DayShift {
  startsAt: string
  endsAt: string
}

export interface DayPlan {
  /** その日（4時区切り）の始まり */
  dayStart: string
  shifts: DayShift[]
  hours: number
  orders: number
  revenueYen: number
  rentalYen: number
  /** 2回の時：間で返す方が安いか */
  returnBetween: boolean
  peakBonusYen: number
  fixed: boolean
}

export interface WeekOption {
  /** 'best'＝おすすめ、'tier-N'＝日跨ぎの第N段階まで、'attack'＝リーダーボードを攻める、'none'＝クエストを気にしない */
  key: string
  label: string
  /** 日跨ぎで届く段階（0は届かない） */
  reachedTier: number
  days: DayPlan[]
  hours: number
  workDays: number
  orders: number
  revenueYen: number
  rentalYen: number
  bonusYen: number
  profitYen: number
  hourlyYen: number | null
  /** 攻める目標に届く時の、順位の賞金（届けば。利益には入れていない） */
  prizeYen: number
}

const iso = (ms: number) => new Date(ms).toISOString()
const businessDayStart = (ms: number) => Math.floor((ms + JST - 4 * HOUR) / DAY) * DAY - JST + 4 * HOUR

/** 段階ごとの増える報酬（並べ替え済み） */
function gainsOf(q: PlannerQuest): { count: number; gain: number }[] {
  const sorted = [...q.tiers].sort((a, b) => a.count - b.count)
  const g = tierGains(q.rewardMode, sorted)
  return sorted.map((t, i) => ({ count: t.count, gain: g[i]! }))
}

/** 件数 n を足した時に、新たに届く段階の報酬の合計と、届く段階 */
function bonusFor(q: PlannerQuest, added: number): { yen: number; tier: number } {
  let yen = 0
  let tier = 0
  gainsOf(q).forEach((t, i) => {
    if (q.count + added >= t.count) {
      tier = i + 1
      if (q.count < t.count) yen += t.gain
    }
  })
  return { yen, tier }
}

interface DayOption extends DayPlan {
  hoursInt: number
  /** 日跨ぎの期間の中の件数（日跨ぎの段階に数える分） */
  questOrders: number
  value: number
}

/** [s, e) のうち、日跨ぎの期間に入る時間の割合（1時間ごと） */
function questShare(input: PlannerInput, t: number, s: number, e: number): number {
  if (!input.quest) return 0
  const qs = parseInstant(input.quest.startsAt)
  const qe = parseInstant(input.quest.endsAt)
  const a = Math.max(t, s, qs)
  const b = Math.min(t + HOUR, e, qe)
  return Math.max(0, b - a) / HOUR
}

/** その日の候補：休み・1回・昼と夜の2回。(時間, 件数) が同じなら利益が一番のものだけ */
function dayOptions(input: PlannerInput, dayStart: number, fromMs: number): DayOption[] {
  // 使える正時（その日の 4時〜翌4時、今より後）
  const usable: { t: number; v: HourValue }[] = []
  for (let k = 0; k < 24; k++) {
    const t = dayStart + k * HOUR
    if (t < fromMs) continue
    const v = input.hour(t)
    if (v) usable.push({ t, v })
  }
  const byTime = new Map(usable.map((u) => [u.t, u.v]))
  const runs: [number, number][] = []
  // 続いている時間のかたまりから、長さ MIN〜最長のシフトを作る
  for (let i = 0; i < usable.length; i++) {
    for (let len = MIN_SHIFT_HOURS; len <= input.maxDayHours; len++) {
      const s = usable[i]!.t
      const e = s + len * HOUR
      let ok = true
      for (let t = s; t < e; t += HOUR) if (!byTime.has(t)) ok = false
      if (!ok) break
      runs.push([s, e])
    }
  }
  const sum = (s: number, e: number) => {
    let revenue = 0
    let orders = 0
    for (let t = s; t < e; t += HOUR) {
      const v = byTime.get(t)!
      revenue += v.revenueYen
      orders += v.orders
    }
    return { revenue, orders }
  }
  // レンタル代が出せない長さ（例：上限の12時間を超える）は null。その借り方は選ばない
  const fee = (seconds: number): number | null => (input.rentalFee ? input.rentalFee(seconds) : 0)
  const build = (shifts: [number, number][]): DayOption | null => {
    let revenue = 0
    let orders = 0
    let questOrders = 0
    for (const [s, e] of shifts) {
      const r = sum(s, e)
      revenue += r.revenue
      orders += r.orders
      for (let t = s; t < e; t += HOUR) questOrders += byTime.get(t)!.orders * questShare(input, t, s, e)
    }
    const hours = shifts.reduce((a, [s, e]) => a + (e - s) / HOUR, 0)
    // レンタル：借りたまま（最初〜最後）と、間で返す（回ごと）の安い方
    const keep = fee((shifts[shifts.length - 1]![1] - shifts[0]![0]) / 1000)
    const parts = shifts.map(([s, e]) => fee((e - s) / 1000))
    const each = parts.some((x) => x === null) ? null : parts.reduce<number>((a, x) => a + x!, 0)
    if (keep === null && each === null) return null
    const returnBetween = shifts.length > 1 && (keep === null || (each !== null && each < keep))
    const rentalYen = returnBetween ? each! : keep!
    // ピーク：覆う時間の件数で届く段階の報酬
    let peakBonusYen = 0
    for (const p of input.peaks) {
      const ps = parseInstant(p.startsAt)
      const pe = parseInstant(p.endsAt)
      if (pe <= dayStart || ps >= dayStart + DAY) continue
      let inPeak = 0
      for (const [s, e] of shifts) {
        for (let t = s; t < e; t += HOUR) {
          const overlap = Math.max(0, Math.min(t + HOUR, pe) - Math.max(t, ps)) / HOUR
          inPeak += byTime.get(t)!.orders * overlap
        }
      }
      peakBonusYen += bonusFor(p, Math.floor(inPeak)).yen
    }
    const value = revenue + peakBonusYen - rentalYen
    return {
      dayStart: iso(dayStart),
      shifts: shifts.map(([s, e]) => ({ startsAt: iso(s), endsAt: iso(e) })),
      hours,
      orders: Math.floor(orders),
      revenueYen: Math.round(revenue),
      rentalYen,
      returnBetween,
      peakBonusYen,
      fixed: false,
      hoursInt: hours,
      questOrders: Math.floor(questOrders),
      value,
    }
  }
  const options: DayOption[] = []
  const add = (o: DayOption | null) => o && options.push(o)
  for (const r of runs) add(build([r]))
  // 昼と夜の2回（間は1時間以上・合計は1日の最長まで）
  // 日の始まり（4時）から数えて、境（16時）より前に終わるのが昼、境から始まるのが夜（深夜0〜4時も夜）
  const split = dayStart + (SPLIT_HOUR - 4) * HOUR
  const lunch = runs.filter(([, e]) => e <= split)
  const dinner = runs.filter(([s]) => s >= split)
  for (const a of lunch) {
    for (const b of dinner) {
      if (b[0] - a[1] < HOUR) continue
      if ((a[1] - a[0] + b[1] - b[0]) / HOUR > input.maxDayHours) continue
      add(build([a, b]))
    }
  }
  // (時間, 件数) が同じなら利益が一番のもの
  const best = new Map<string, DayOption>()
  for (const o of options) {
    const key = `${o.hoursInt}|${o.questOrders}`
    const cur = best.get(key)
    if (!cur || o.value > cur.value) best.set(key, o)
  }
  return [...best.values()]
}

/** 決まっている日（すでに選んだ候補枠）の中身 */
function fixedDay(input: PlannerInput, dayStart: number, slots: readonly { startsAt: string; endsAt: string }[]): DayOption {
  let revenue = 0
  let orders = 0
  let questOrders = 0
  let hours = 0
  for (const sl of slots) {
    const s = parseInstant(sl.startsAt)
    const e = parseInstant(sl.endsAt)
    hours += (e - s) / HOUR
    for (let t = Math.floor(s / HOUR) * HOUR; t < e; t += HOUR) {
      const v = input.hour(t)
      if (!v) continue
      const part = (Math.min(t + HOUR, e) - Math.max(t, s)) / HOUR
      revenue += v.revenueYen * part
      orders += v.orders * part
      questOrders += v.orders * questShare(input, t, s, e)
    }
  }
  const fee = input.rentalFee ? slots.reduce((a, sl) => a + (input.rentalFee!((parseInstant(sl.endsAt) - parseInstant(sl.startsAt)) / 1000) ?? 0), 0) : 0
  return {
    dayStart: iso(dayStart),
    shifts: slots.map((sl) => ({ startsAt: sl.startsAt, endsAt: sl.endsAt })),
    hours: Math.round(hours * 10) / 10,
    orders: Math.floor(orders),
    revenueYen: Math.round(revenue),
    rentalYen: fee,
    returnBetween: false,
    peakBonusYen: 0,
    fixed: true,
    hoursInt: Math.ceil(hours),
    questOrders: Math.floor(questOrders),
    value: revenue - fee,
  }
}

export function planWeekShifts(input: PlannerInput): { options: WeekOption[]; recommended: string | null } {
  const now = parseInstant(input.now)
  const fromMs = Math.ceil(Math.max(now, parseInstant(input.from)) / HOUR) * HOUR
  const toMs = parseInstant(input.to)
  const days: DayOption[][] = []
  for (let d = businessDayStart(fromMs); d < toMs; d += DAY) {
    const fixed = input.fixed.filter((sl) => {
      const s = parseInstant(sl.startsAt)
      return s >= d && s < d + DAY && parseInstant(sl.endsAt) > now
    })
    const rest: DayOption = { dayStart: iso(d), shifts: [], hours: 0, orders: 0, revenueYen: 0, rentalYen: 0, returnBetween: false, peakBonusYen: 0, fixed: false, hoursInt: 0, questOrders: 0, value: 0 }
    days.push(fixed.length ? [fixedDay(input, d, fixed)] : [rest, ...dayOptions(input, d, Math.max(fromMs, d))])
  }

  // 日跨ぎで数える件数の上限（最後の段階か、攻める目標まで。それより多くは区別しない）
  const quest = input.quest
  const lastTier = quest ? Math.max(0, ...quest.tiers.map((t) => t.count)) : 0
  const attack = quest && input.attack && input.attack.count > lastTier ? input.attack : null
  const need = quest ? Math.max(0, Math.max(lastTier, attack?.count ?? 0) - quest.count) : 0
  const cap = days.reduce((a, opts) => a + Math.max(...opts.map((o) => o.hoursInt)), 0)
  const maxHours = Math.min(cap, input.budgetHours === null ? cap : Math.max(0, Math.floor(input.budgetHours)))
  const W = need + 1
  // dp[h*W+o]＝最大の値、choice＝日ごとの選んだ候補
  let dp = new Float64Array((maxHours + 1) * W).fill(-Infinity)
  dp[0] = 0
  const back: Int32Array[] = []
  const backPrev: Int32Array[] = []
  for (const opts of days) {
    const next = new Float64Array(dp.length).fill(-Infinity)
    const pick = new Int32Array(dp.length).fill(-1)
    const prev = new Int32Array(dp.length).fill(-1)
    for (let st = 0; st < dp.length; st++) {
      const v = dp[st]!
      if (v === -Infinity) continue
      const h = Math.floor(st / W)
      const o = st % W
      opts.forEach((op, k) => {
        const nh = h + op.hoursInt
        if (nh > maxHours) return
        const no = Math.min(need, o + op.questOrders)
        const ns = nh * W + no
        const nv = v + op.value
        if (nv > next[ns]!) {
          next[ns] = nv
          pick[ns] = k
          prev[ns] = st
        }
      })
    }
    dp = next
    back.push(pick)
    backPrev.push(prev)
  }

  const trace = (st: number): DayOption[] => {
    const out: DayOption[] = []
    for (let i = days.length - 1; i >= 0; i--) {
      out.unshift(days[i]![back[i]![st]!]!)
      st = backPrev[i]![st]!
    }
    return out
  }
  const summarize = (key: string, label: string, st: number): WeekOption => {
    const plan = trace(st)
    const orders = plan.reduce((a, d) => a + d.orders, 0)
    const hours = plan.reduce((a, d) => a + d.hours, 0)
    const main = quest ? bonusFor(quest, plan.reduce((a, d) => a + d.questOrders, 0)) : { yen: 0, tier: 0 }
    const revenueYen = plan.reduce((a, d) => a + d.revenueYen, 0)
    const rentalYen = plan.reduce((a, d) => a + d.rentalYen, 0)
    const bonusYen = main.yen + plan.reduce((a, d) => a + d.peakBonusYen, 0)
    const profitYen = revenueYen + bonusYen - rentalYen
    return {
      key,
      label,
      reachedTier: main.tier,
      days: plan.map(({ hoursInt: _h, questOrders: _o, value: _v, ...d }) => d),
      hours: Math.round(hours * 10) / 10,
      workDays: plan.filter((d) => d.shifts.length > 0).length,
      orders,
      revenueYen,
      rentalYen,
      bonusYen,
      profitYen,
      hourlyYen: hours > 0 ? Math.round(profitYen / hours) : null,
      prizeYen: attack && quest && st % W >= attack.count - quest.count ? attack.prizeYen : 0,
    }
  }
  // 状態ごとの点数：利益（日跨ぎの報酬込み）。目標時給があれば「利益−目標×時間」
  const score = (st: number) => {
    const h = Math.floor(st / W)
    const o = st % W
    const bonus = quest ? bonusFor(quest, o).yen : 0
    const profit = dp[st]! + bonus
    return input.targetHourlyYen === null ? profit : profit - input.targetHourlyYen * h
  }
  const bestWhere = (ok: (o: number) => boolean): number | null => {
    let best: number | null = null
    for (let st = 0; st < dp.length; st++) {
      if (dp[st] === -Infinity || !ok(st % W)) continue
      if (best === null || score(st) > score(best)) best = st
    }
    return best
  }

  // 同じ組み合わせになった選択肢は1つにまとめ、名前を並べる（例：「おすすめ・本命 50件」）
  const found: { key: string; label: string; st: number }[] = []
  const push = (key: string, label: string, st: number | null) => {
    if (st === null) return
    const same = found.find((f) => f.st === st)
    if (same) same.label = `${same.label}・${label}`
    else found.push({ key, label, st })
  }
  const overall = bestWhere(() => true)
  push('best', 'おすすめ', overall)
  if (quest) {
    const sorted = [...quest.tiers].sort((a, b) => a.count - b.count)
    sorted.forEach((t, i) => {
      if (quest.count >= t.count) return
      const label = i === sorted.length - 1 ? `本命 ${t.count}件` : i === 0 ? `最低 ${t.count}件` : `第${i + 1}段階 ${t.count}件`
      // その段階まで（次の段階には届かない）で一番良い組み合わせ
      const next = sorted[i + 1]
      push(`tier-${i + 1}`, label, bestWhere((o) => o >= t.count - quest.count && (!next || o < next.count - quest.count)))
    })
    // 攻める：リーダーボードの目標の件数まで（本命より多い時だけ）
    if (attack) push('attack', `攻める ${attack.rank}位 ${attack.count}件`, bestWhere((o) => o >= attack.count - quest.count))
    // クエストを気にしない：日跨ぎの報酬を入れずに点数が最大
    const plain = (st: number) => dp[st]! - (input.targetHourlyYen ?? 0) * Math.floor(st / W)
    let free: number | null = null
    for (let st = 0; st < dp.length; st++) if (dp[st] !== -Infinity && (free === null || plain(st) > plain(free))) free = st
    push('none', 'クエストを気にしない', free)
  }
  const options = found.map((f) => summarize(f.key, f.label, f.st))
  return { options, recommended: options[0]?.key ?? null }
}
