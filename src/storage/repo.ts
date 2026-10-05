// データの読み書き。保存前の検証と、まとめて書く操作（トランザクション）をここに集める
import { assertYen, localMonth, parseInstant } from '../domain'
import type { DeliKanDB } from './db'
import { EQUIPMENT_PRESETS, TARIFF_PRESETS, type EquipmentPresetItem } from './presets'
import type {
  AssetRecord,
  EquipmentPlanRecord,
  PlanItemRecord,
  RecurringExpenseRecord,
  SessionRecord,
  QuestRecord,
  SettingsRecord,
  SlotRecord,
  TariffRecord,
} from './schema'

export const newId = (): string => crypto.randomUUID()
const nowIso = (): string => new Date().toISOString()

export class ValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join('\n'))
    this.name = 'ValidationError'
  }
}

function stamp<T extends { createdAt?: string; updatedAt?: string; revision?: number }>(
  record: T,
): T & { createdAt: string; updatedAt: string; revision: number } {
  const now = nowIso()
  return { ...record, createdAt: record.createdAt || now, updatedAt: now, revision: (record.revision ?? 0) + 1 }
}

/** 初期データ（料金プリセット・空の設定・装備の3プラン）。復元・全削除でも同じものを使う */
export function initialRecords(): { settings: SettingsRecord; tariffs: TariffRecord[]; plans: EquipmentPlanRecord[] } {
  // 一覧の並びがプリセットの順になるよう、作成日時を1ミリ秒ずつずらす
  const base = Date.now()
  return {
    settings: stamp({
      id: 'settings',
      originLabel: null,
      targetHourlyYen: null,
      weeklyBudgetMinutes: null,
      homeDeadline: null,
      defaultTariffId: null,
    } as SettingsRecord),
    tariffs: TARIFF_PRESETS.map((p, i) =>
      stamp({
        createdAt: new Date(base + i).toISOString(),
        id: newId(),
        name: p.name,
        tariff: p.tariff,
        sourceUrl: p.sourceUrl,
        verifiedAt: p.verifiedAt,
        archived: false,
      } as TariffRecord),
    ),
    plans: (['beginner', 'intermediate', 'advanced'] as const).map((tier) =>
      stamp({ id: newId(), name: EQUIPMENT_PRESETS[tier].name, tier, items: EQUIPMENT_PRESETS[tier].items.map(planItemFromPreset) } as EquipmentPlanRecord),
    ),
  }
}

/** 初回に初期データを用意する（既にあれば何もしない） */
export async function ensureInitialData(db: DeliKanDB): Promise<void> {
  await db.transaction('rw', [db.settings, db.tariffs, db.plans], async () => {
    const initial = initialRecords()
    if ((await db.tariffs.count()) === 0) await db.tariffs.bulkAdd(initial.tariffs)
    if (!(await db.settings.get('settings'))) await db.settings.add(initial.settings)
    if ((await db.plans.count()) === 0) await db.plans.bulkAdd(initial.plans)
  })
}

export function planItemFromPreset(p: EquipmentPresetItem): PlanItemRecord {
  return {
    id: newId(),
    label: p.label,
    category: p.category,
    unitYen: null,
    quantity: 1,
    state: 'planned',
    businessRatioBps: 10000,
    lifetimeMonths: p.lifetimeMonths,
    residualYen: 0,
    assetId: null,
  }
}

// ---- 設定 ----

export async function saveSettings(db: DeliKanDB, patch: Partial<Omit<SettingsRecord, 'id'>>): Promise<void> {
  const problems: string[] = []
  if (patch.targetHourlyYen != null && (!Number.isSafeInteger(patch.targetHourlyYen) || patch.targetHourlyYen < 0)) {
    problems.push('目標時給は0以上の整数円で入力してください')
  }
  if (patch.weeklyBudgetMinutes != null && (!Number.isSafeInteger(patch.weeklyBudgetMinutes) || patch.weeklyBudgetMinutes < 0)) {
    problems.push('週の時間は0以上で入力してください')
  }
  if (patch.homeDeadline != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.homeDeadline)) {
    problems.push('帰宅締切は 21:30 のように入力してください')
  }
  if (problems.length) throw new ValidationError(problems)
  const current = await db.settings.get('settings')
  if (!current) throw new Error('設定が見つかりません')
  await db.settings.put(stamp({ ...current, ...patch }))
}

/** 料金を編集すると新しい版を作る。古い版は残す（過去の記録はスナップショットなので変わらない） */
export async function saveTariff(db: DeliKanDB, record: Omit<TariffRecord, 'id' | 'createdAt' | 'updatedAt' | 'revision' | 'archived'> & { id?: string }): Promise<string> {
  validateTariff(record.tariff)
  const id = newId()
  await db.transaction('rw', [db.tariffs, db.settings], async () => {
    if (record.id) {
      await db.tariffs.update(record.id, { archived: true })
      const settings = await db.settings.get('settings')
      if (settings?.defaultTariffId === record.id) await db.settings.put(stamp({ ...settings, defaultTariffId: id }))
    }
    await db.tariffs.add(stamp({ ...record, id, archived: false } as TariffRecord))
  })
  return id
}

function validateTariff(t: TariffRecord['tariff']): void {
  const problems: string[] = []
  const posInt = (v: number, label: string) => {
    if (!Number.isSafeInteger(v) || v <= 0) problems.push(`${label} は1以上の整数で入力してください`)
  }
  if (t.kind === 'tiered') {
    posInt(t.initialMinutes, '最初の時間（分）')
    posInt(t.stepMinutes, '加算の単位（分）')
    posInt(t.capMinutes, '上限の対象時間（分）')
    for (const [v, label] of [[t.initialYen, '最初の料金'], [t.stepYen, '加算の料金'], [t.capYen, '上限料金']] as const) {
      if (!Number.isSafeInteger(v) || v < 0) problems.push(`${label} は0以上の整数円で入力してください`)
    }
  } else if (t.kind === 'pass') {
    if (t.passes.length === 0) problems.push('パスを1つ以上登録してください')
    t.passes.forEach((p) => posInt(p.minutes, 'パスの時間（分）'))
  }
  if (problems.length) throw new ValidationError(problems)
}

/** 使用中の料金（作成順）。並びが毎回同じになるようにする */
export async function listTariffs(db: DeliKanDB): Promise<TariffRecord[]> {
  const all = await db.tariffs.filter((t) => !t.archived).toArray()
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))
}

/** よく使う料金（設定）→ なければ一覧の先頭 */
export function pickDefaultTariff(tariffs: readonly TariffRecord[], settings: SettingsRecord | undefined): TariffRecord | undefined {
  return tariffs.find((t) => t.id === settings?.defaultTariffId) ?? tariffs[0]
}

// ---- 稼働の記録 ----

export function sessionEndMs(s: SessionRecord): number {
  return s.returnedAt ? parseInstant(s.returnedAt) : s.status === 'active' ? Date.now() : parseInstant(s.departedAt)
}

/** 1件の記録だけで分かる問題（時刻の順序・確定の条件・金額）。保存時と復元時の両方で使う */
export function sessionRecordProblems(s: SessionRecord): string[] {
  const problems: string[] = []
  let departedMs: number
  try {
    departedMs = parseInstant(s.departedAt, '出発')
  } catch (e) {
    return [(e as Error).message]
  }
  if (s.returnedAt) {
    try {
      if (parseInstant(s.returnedAt, '帰宅') <= departedMs) problems.push('帰宅は出発より後にしてください')
    } catch (e) {
      problems.push((e as Error).message)
    }
  }
  if (s.status === 'completed' && !s.returnedAt) problems.push('確定するには帰宅時刻が必要です')
  if (s.status === 'completed' && s.baseYen == null) problems.push('確定するには基本報酬（0円も可）を入力してください')
  const yen = (v: number | null, label: string, allowNegative = false) => {
    if (v == null) return
    try {
      assertYen(v, label, { allowNegative })
    } catch (e) {
      problems.push((e as Error).message)
    }
  }
  yen(s.baseYen, '基本報酬')
  yen(s.tipsYen, 'チップ')
  s.adjustments.forEach((a) => yen(a.amountYen, a.kind === 'quest' ? 'クエスト' : '調整', a.kind === 'other'))
  s.rentals.forEach((r) => yen(r.billedYen, '実請求額'))
  s.directExpenses.forEach((e) => yen(e.amountYen, '経費'))
  if (s.completedCount != null && (!Number.isSafeInteger(s.completedCount) || s.completedCount < 0)) {
    problems.push('件数は0以上の整数で入力してください')
  }
  if (s.summaryOnlineSeconds != null && (!Number.isFinite(s.summaryOnlineSeconds) || s.summaryOnlineSeconds < 0)) {
    problems.push('オンライン時間は0以上で入力してください')
  }
  for (const r of s.rentals) {
    try {
      if (r.startAt && r.endAt && parseInstant(r.endAt) < parseInstant(r.startAt)) problems.push('レンタルの返却が貸出より前です')
    } catch (e) {
      problems.push((e as Error).message)
    }
  }
  return problems
}

/** 記録どうしの問題（稼働中は1件まで・時間の重なり）。開始時刻順に並べて隣どうしを比べる */
export function sessionSetProblems(sessions: readonly SessionRecord[]): string[] {
  const problems: string[] = []
  if (sessions.filter((s) => s.status === 'active').length > 1) problems.push('稼働中の記録が2件以上あります')
  const spans = sessions
    .map((s) => ({ start: parseInstant(s.departedAt), end: sessionEndMs(s) }))
    .sort((a, b) => a.start - b.start)
  let maxEnd = -Infinity
  for (const span of spans) {
    if (span.start < maxEnd) {
      problems.push('時間が重なっている記録があります')
      break
    }
    maxEnd = Math.max(maxEnd, span.end)
  }
  return problems
}

/** 保存前の検証。帰宅＞出発、確定には帰宅が必要、稼働中は1件まで、他の記録と時間が重ならない */
export async function validateSession(db: DeliKanDB, s: SessionRecord): Promise<string[]> {
  const problems = sessionRecordProblems(s)
  if (problems.length) return problems
  const departedMs = parseInstant(s.departedAt)

  const others = (await db.sessions.toArray()).filter((o) => o.id !== s.id)
  if (s.status === 'active' && others.some((o) => o.status === 'active')) problems.push('稼働中の記録はすでに1件あります')
  const start = departedMs
  const end = sessionEndMs(s)
  const overlap = others.find((o) => {
    const oStart = parseInstant(o.departedAt)
    const oEnd = sessionEndMs(o)
    return start < oEnd && oStart < end
  })
  if (overlap) problems.push('ほかの記録と時間が重なっています')
  return problems
}

export async function saveSession(db: DeliKanDB, s: SessionRecord): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const problems = await validateSession(db, s)
    if (problems.length) throw new ValidationError(problems)
    await db.sessions.put(stamp(s))
  })
}

export function emptySession(departedAt: string, status: SessionRecord['status']): SessionRecord {
  return {
    id: newId(),
    status,
    departedAt,
    returnedAt: null,
    platform: 'uber',
    weather: null,
    areaLabel: '',
    revenueMode: 'summary',
    baseYen: null,
    tipsYen: null,
    completedCount: null,
    adjustments: [],
    summaryOnlineSeconds: null,
    rentals: [],
    directExpenses: [],
    note: '',
    createdAt: '',
    updatedAt: '',
    revision: 0,
  }
}

/** 自宅を出発（稼働中の記録を作る）。レンタル開始とは別の操作 */
export async function departNow(db: DeliKanDB, at = nowIso()): Promise<string> {
  const s = emptySession(at, 'active')
  await saveSession(db, s)
  return s.id
}

export async function startRental(db: DeliKanDB, sessionId: string, tariff: TariffRecord, at = nowIso()): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const s = await db.sessions.get(sessionId)
    if (!s) throw new Error('記録が見つかりません')
    if (s.rentals.some((r) => r.startAt && !r.endAt)) throw new ValidationError(['返却していないレンタルがあります'])
    s.rentals.push({ id: newId(), tariffName: tariff.name, tariff: tariff.tariff, startAt: at, endAt: null, billedYen: null })
    await db.sessions.put(stamp(s))
  })
}

export async function endRental(db: DeliKanDB, sessionId: string, rentalId: string, at = nowIso()): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const s = await db.sessions.get(sessionId)
    const r = s?.rentals.find((x) => x.id === rentalId)
    if (!s || !r) throw new Error('レンタルが見つかりません')
    r.endAt = at
    await db.sessions.put(stamp(s))
  })
}

/**
 * 帰宅：返却していないレンタルを返却し、稼働中を終えて「精算待ちの下書き」にする。
 * 精算画面で保存する前に画面を閉じても、稼働中が残って次の出発を妨げない。
 */
export async function arriveHome(db: DeliKanDB, sessionId: string, at = nowIso()): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const s = await db.sessions.get(sessionId)
    if (!s) throw new Error('記録が見つかりません')
    for (const r of s.rentals) if (r.startAt && !r.endAt) r.endAt = at
    const next: SessionRecord = { ...s, status: s.status === 'active' ? 'draft' : s.status, returnedAt: s.returnedAt ?? at }
    const problems = await validateSession(db, next)
    if (problems.length) throw new ValidationError(problems)
    await db.sessions.put(stamp(next))
  })
}

/** 削除した記録を返す（直後の「元に戻す」に使う） */
export async function deleteSession(db: DeliKanDB, id: string): Promise<SessionRecord | undefined> {
  return db.transaction('rw', db.sessions, async () => {
    const s = await db.sessions.get(id)
    if (s) await db.sessions.delete(id)
    return s
  })
}

export async function restoreSession(db: DeliKanDB, s: SessionRecord): Promise<void> {
  await db.sessions.put(s)
}

// ---- 固定費 ----

export async function saveRecurringExpense(db: DeliKanDB, e: Omit<RecurringExpenseRecord, 'createdAt' | 'updatedAt' | 'revision'> & Partial<RecurringExpenseRecord>): Promise<void> {
  const problems: string[] = []
  try {
    assertYen(e.amountYen, '金額')
  } catch (err) {
    problems.push((err as Error).message)
  }
  if (!/^\d{4}-\d{2}$/.test(e.startMonth)) problems.push('開始月を選んでください')
  if (e.endMonth && e.endMonth < e.startMonth) problems.push('終了月は開始月以降にしてください')
  if (!e.label.trim()) problems.push('名前を入力してください')
  if (problems.length) throw new ValidationError(problems)
  await db.recurringExpenses.put(stamp(e as RecurringExpenseRecord))
}

// ---- 装備プランと資産 ----

export async function savePlan(db: DeliKanDB, plan: EquipmentPlanRecord): Promise<void> {
  const problems: string[] = []
  for (const item of plan.items) {
    const name = item.label || '名前のない品目'
    if (!item.label.trim()) problems.push('品目の名前を入力してください')
    if (item.unitYen !== null && (!Number.isSafeInteger(item.unitYen) || item.unitYen < 0)) problems.push(`${name}：価格は0以上の整数円です`)
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) problems.push(`${name}：数量は1以上です`)
    if (!Number.isSafeInteger(item.lifetimeMonths) || item.lifetimeMonths < 1) problems.push(`${name}：配賦期間は1か月以上です`)
    if (!Number.isSafeInteger(item.businessRatioBps) || item.businessRatioBps < 0 || item.businessRatioBps > 10000) {
      problems.push(`${name}：業務使用割合は0〜100%です`)
    }
    if (!Number.isSafeInteger(item.residualYen) || item.residualYen < 0) problems.push(`${name}：残存額は0以上の整数円です`)
  }
  if (problems.length) throw new ValidationError(problems)
  await db.plans.put(stamp(plan))
}

/** プリセットをプランにコピーする。購入済み・所有済みの品目は上書きせず残す */
export function applyPreset(plan: EquipmentPlanRecord, items: EquipmentPresetItem[]): EquipmentPlanRecord {
  const kept = plan.items.filter((i) => i.state !== 'planned')
  return { ...plan, items: [...kept, ...items.map(planItemFromPreset)] }
}

/**
 * 品目を「購入した」「前から持っている」にして資産を作る。
 * 予定の品目は資産にしない（実績の回収残に入らない）。
 */
export async function acquirePlanItem(
  db: DeliKanDB,
  planId: string,
  itemId: string,
  acquisition: { state: 'purchased'; purchasedAt: string } | { state: 'owned'; managementValueYen: number | null; inServiceMonth: string },
): Promise<string> {
  return db.transaction('rw', [db.plans, db.assets], async () => {
    const plan = await db.plans.get(planId)
    const item = plan?.items.find((i) => i.id === itemId)
    if (!plan || !item) throw new Error('品目が見つかりません')
    if (item.assetId) throw new ValidationError(['この品目はすでに登録済みです'])
    if (acquisition.state === 'purchased' && item.unitYen === null) throw new ValidationError(['購入にするには価格を入力してください'])
    if (acquisition.state === 'owned' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(acquisition.inServiceMonth)) {
      throw new ValidationError(['使い始めた月を選んでください'])
    }
    if (acquisition.state === 'purchased') {
      try {
        parseInstant(acquisition.purchasedAt, '購入日')
      } catch {
        throw new ValidationError(['購入日を選んでください'])
      }
    }
    const purchased = acquisition.state === 'purchased'
    const asset: AssetRecord = stamp({
      id: newId(),
      label: item.label,
      category: item.category,
      sourcePlanItemId: item.id,
      status: acquisition.state,
      purchasedAt: purchased ? acquisition.purchasedAt : null,
      inServiceMonth: purchased ? localMonth(acquisition.purchasedAt) : acquisition.inServiceMonth,
      unitYen: item.unitYen ?? 0,
      quantity: item.quantity,
      businessRatioBps: item.businessRatioBps,
      managementValueYen: purchased ? null : acquisition.managementValueYen,
      residualYen: item.residualYen,
      lifetimeMonths: item.lifetimeMonths,
      soldAt: null,
      businessSaleYen: null,
    } as AssetRecord)
    const value = purchased
      ? Math.round((asset.unitYen * asset.quantity * asset.businessRatioBps) / 10000)
      : (asset.managementValueYen ?? 0)
    if (asset.residualYen > value) throw new ValidationError(['残存額は管理対象の価値以下にしてください'])
    await db.assets.add(asset)
    item.state = acquisition.state
    item.assetId = asset.id
    await db.plans.put(stamp(plan))
    return asset.id
  })
}

/** 資産を消す。元のプラン品目は「予定」に戻す */
export async function deleteAsset(db: DeliKanDB, assetId: string): Promise<void> {
  await db.transaction('rw', [db.plans, db.assets], async () => {
    await db.assets.delete(assetId)
    for (const plan of await db.plans.toArray()) {
      const item = plan.items.find((i) => i.assetId === assetId)
      if (item) {
        item.assetId = null
        item.state = 'planned'
        await db.plans.put(stamp(plan))
      }
    }
  })
}

// ---- 計画の候補枠 ----

export async function saveSlot(db: DeliKanDB, slot: SlotRecord): Promise<void> {
  const problems: string[] = []
  try {
    if (parseInstant(slot.endsAt, '帰宅予定') <= parseInstant(slot.startsAt, '出発予定')) problems.push('帰宅予定は出発予定より後にしてください')
  } catch (e) {
    problems.push((e as Error).message)
  }
  for (const [label, v] of [
    ['悲観の売上', slot.revenueYen.pessimistic],
    ['標準の売上', slot.revenueYen.standard],
    ['楽観の売上', slot.revenueYen.optimistic],
    ['想定レンタル代', slot.rentalOverrideYen],
  ] as const) {
    if (v !== null && (!Number.isSafeInteger(v) || v < 0)) problems.push(`${label}は0以上の整数円で入力してください`)
  }
  if (!Number.isSafeInteger(slot.expenseYen) || slot.expenseYen < 0) problems.push('経費は0以上の整数円で入力してください')
  if (problems.length) throw new ValidationError(problems)
  await db.slots.put(stamp(slot))
}

// ---- クエスト ----

/** クエストの制約。保存時と復元時の両方で使う */
export function questProblems(quest: QuestRecord): string[] {
  const problems: string[] = []
  if (!quest.label.trim()) problems.push('名前を入力してください')
  try {
    if (parseInstant(quest.endsAt, '終了') <= parseInstant(quest.startsAt, '開始')) problems.push('終了は開始より後にしてください')
  } catch (e) {
    problems.push((e as Error).message)
  }
  if (quest.tiers.length === 0) problems.push('段階を1つ以上入れてください')
  const counts = quest.tiers.map((t) => t.count)
  if (quest.tiers.some((t) => !Number.isSafeInteger(t.count) || t.count < 1)) problems.push('件数は1以上の整数で入力してください')
  if (quest.tiers.some((t) => !Number.isSafeInteger(t.rewardYen) || t.rewardYen < 0)) problems.push('報酬は0以上の整数円で入力してください')
  if (new Set(counts).size !== counts.length) problems.push('同じ件数の段階が2つあります')
  if (!Number.isSafeInteger(quest.manualOffset)) problems.push('件数の調整は整数で入力してください')
  if (quest.rewardMode === 'cumulative') {
    // 累積（達成時の合計額）は、件数が増えるほど同じか増えていないとおかしい
    const sorted = [...quest.tiers].sort((a, b) => a.count - b.count)
    if (sorted.some((t, i) => i > 0 && t.rewardYen < sorted[i - 1]!.rewardYen)) {
      problems.push('累積（達成時の合計額）の報酬が、前の段階より少なくなっています。各段階の上乗せ額なら「段階ごとに上乗せされる額」を選んでください')
    }
  }
  return problems
}

export async function saveQuest(db: DeliKanDB, quest: QuestRecord): Promise<void> {
  const problems = questProblems(quest)
  if (problems.length) throw new ValidationError(problems)
  await db.quests.put(stamp({ ...quest, tiers: [...quest.tiers].sort((a, b) => a.count - b.count) }))
}
