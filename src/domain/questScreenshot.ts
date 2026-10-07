// クエストの画面のスクショから読み取った文字（端末の中の文字認識の結果）を、クエストの期間と段階に直す。
// 配達アプリの「クエストの進捗」の画面を利用者が自分で撮って渡したものだけを使う（配達中の画面は使わない）。
// 文字認識は誤りがあるので、読み取った値は入力欄に入れて利用者が確かめてから保存する
import type { QuestTier } from './quest'

export interface QuestReading {
  /** 期間（日本時間）。読み取れなければ null */
  startsAt: string | null
  endsAt: string | null
  /** 段階（件数は累計。報酬は段階ごとに上乗せされる額） */
  tiers: QuestTier[]
  /** 読み取れなかったもの（利用者に手で入れてもらう） */
  missing: ('start' | 'end' | 'tiers')[]
}

const JST = 9 * 3_600_000
const WEEKDAYS = '日月火水木金土'

/** 文字認識の結果をそろえる：空白を除き、全角の数字・記号を半角に、¥ の読み違い（\ や Y）を ¥ に */
export function normalizeOcrText(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ':')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[＋]/g, '+')
    .replace(/[〜～~]/g, '〜')
    .replace(/[ \t　]+/g, '')
    .replace(/\\+|[Y￥]/g, '¥')
}

/** 年のない「10月9日 4:00」を、今に一番近い年の日本時間にする */
function monthDay(nowMs: number, month: number, day: number, hour: number, minute: number): string {
  const y = new Date(nowMs + JST).getUTCFullYear()
  const candidates = [y - 1, y, y + 1].map((yy) => Date.UTC(yy, month - 1, day, hour, minute) - JST)
  const best = candidates.reduce((a, b) => (Math.abs(b - nowMs) < Math.abs(a - nowMs) ? b : a))
  return new Date(best).toISOString()
}

/** 「水曜日 午後4時30分」を、基準の時刻から見て次のその曜日・時刻（同じ日のまだ来ていない時刻を含む）の日本時間にする */
function nextWeekdayTime(nowMs: number, weekday: number, hour: number, minute: number): string {
  const jstNow = new Date(nowMs + JST)
  const today = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate(), hour, minute) - JST
  let diff = (weekday - jstNow.getUTCDay() + 7) % 7
  if (diff === 0 && today <= nowMs) diff = 7
  return new Date(today + diff * 86_400_000).toISOString()
}

const to24 = (ampm: string | undefined, h: number) => (ampm === '午後' && h < 12 ? h + 12 : ampm === '午前' && h === 12 ? 0 : h)

export function parseQuestText(text: string, nowIso: string): QuestReading {
  const t = normalizeOcrText(text)
  const nowMs = Date.parse(nowIso)
  let startsAt: string | null = null
  let endsAt: string | null = null

  // 期間：「10月9日(金)4:00〜10月12日(月)4:00」（時刻の : は . と読まれることがある。改行をまたぐことがある）
  const joined = t.replace(/\n/g, '')
  const dates = [...joined.matchAll(/(\d{1,2})月(\d{1,2})日(?:\([^)]{0,2}\))?(\d{1,2})[:.](\d{2})/g)]
  if (dates.length >= 1) {
    const [, m, d, h, mi] = dates[0]!
    startsAt = monthDay(nowMs, Number(m), Number(d), Number(h), Number(mi))
  }
  if (dates.length >= 2) {
    const [, m, d, h, mi] = dates[1]!
    endsAt = monthDay(nowMs, Number(m), Number(d), Number(h), Number(mi))
  }
  // 開始・終了：「クエストの開始は水曜日午後4時30分です」（期間が出ていない画面）
  const at = (word: string, baseMs: number) => {
    const r = joined.match(new RegExp(`${word}は([${WEEKDAYS}])曜日?(午前|午後)?(\\d{1,2})時(\\d{1,2})分`))
    if (!r) return null
    return nextWeekdayTime(baseMs, WEEKDAYS.indexOf(r[1]!), to24(r[2], Number(r[3])), Number(r[4]))
  }
  startsAt ??= at('開始', nowMs)
  // 終了は、開始より後の最初のその曜日・時刻（開始が来週になったら、終了も来週）
  endsAt ??= at('終了', startsAt ? Date.parse(startsAt) : nowMs)

  // 段階：「40回の乗車 ¥3,770」「10回の乗車 +¥1,170」。件数は段階ごとに足していく（1回目の段階も含めて）
  const tiers: QuestTier[] = []
  let count = 0
  for (const line of t.split('\n')) {
    const r = line.match(/(\d+)回の(?:乗車|配達|配送|リクエスト)[^¥\d]*\+?¥([\d,.]+)/)
    if (!r) continue
    const reward = Number(r[2]!.replace(/[,.](?=\d{3}(\D|$))/g, '').replace(/[,.]/g, ''))
    if (!Number.isFinite(reward)) continue
    count += Number(r[1])
    tiers.push({ count, rewardYen: reward })
  }

  const missing: QuestReading['missing'] = []
  if (!startsAt) missing.push('start')
  if (!endsAt) missing.push('end')
  if (tiers.length === 0) missing.push('tiers')
  return { startsAt, endsAt, tiers, missing }
}
