// IndexedDB（Dexie）。実績とデモは別のデータベースに分け、合成データが実績に混ざらないようにする
import Dexie, { type EntityTable } from 'dexie'
import type {
  AssetRecord,
  EquipmentPlanRecord,
  RecurringExpenseRecord,
  SessionRecord,
  SettingsRecord,
  SlotRecord,
  TariffRecord,
} from './schema'

export type DataMode = 'real' | 'demo'

export class DeliKanDB extends Dexie {
  settings!: EntityTable<SettingsRecord, 'id'>
  tariffs!: EntityTable<TariffRecord, 'id'>
  sessions!: EntityTable<SessionRecord, 'id'>
  recurringExpenses!: EntityTable<RecurringExpenseRecord, 'id'>
  plans!: EntityTable<EquipmentPlanRecord, 'id'>
  assets!: EntityTable<AssetRecord, 'id'>
  slots!: EntityTable<SlotRecord, 'id'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      settings: 'id',
      tariffs: 'id, archived',
      sessions: 'id, status, departedAt, returnedAt',
      recurringExpenses: 'id, startMonth',
      plans: 'id, tier',
      assets: 'id, inServiceMonth',
    })
    // 版2：計画の候補枠を追加（既存のデータはそのまま）
    this.version(2).stores({ slots: 'id, startsAt' })
  }
}

export const DB_NAMES: Record<DataMode, string> = { real: 'deli-kan', demo: 'deli-kan-demo' }

const instances = new Map<DataMode, DeliKanDB>()

export function getDb(mode: DataMode): DeliKanDB {
  let db = instances.get(mode)
  if (!db) {
    db = new DeliKanDB(DB_NAMES[mode])
    instances.set(mode, db)
  }
  return db
}

const MODE_KEY = 'deli-kan:mode'

/** デモ表示かどうかは、この端末の表示の好みとして覚える（読めなければ実績） */
export function loadMode(): DataMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'demo' ? 'demo' : 'real'
  } catch {
    return 'real'
  }
}

export function saveMode(mode: DataMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // 保存できなくても、開いている間は切り替わる
  }
}
