// 端末に保存するデータの形（docs/spec/docs/03-data-model.md を MVP 向けに簡略化）
// 子レコード（レンタル・調整・直接経費）はセッションの中に持ち、1回の書き込みでまとめて保存・削除する
import type { EquipmentCategory, Platform, Tariff } from '../domain'

export const SCHEMA_VERSION = 1

interface Stamped {
  createdAt: string
  updatedAt: string
  revision: number
}

export interface SettingsRecord extends Stamped {
  id: 'settings'
  /** 起点の表示名（任意。未入力は null＝「起点未設定」） */
  originLabel: string | null
  targetHourlyYen: number | null
  weeklyBudgetMinutes: number | null
  /** 帰宅締切 HH:mm */
  homeDeadline: string | null
  defaultTariffId: string | null
}

export interface TariffRecord extends Stamped {
  id: string
  name: string
  tariff: Tariff
  sourceUrl: string | null
  /** 料金を確かめた日 YYYY-MM-DD */
  verifiedAt: string | null
  /** 編集すると新しい版を作り、古い版は archived にする（過去の記録はスナップショットで固定） */
  archived: boolean
}

export type Weather = 'clear' | 'cloudy' | 'light_rain' | 'heavy_rain' | 'hot' | 'windy' | 'snow'

export interface RentalRecord {
  id: string
  tariffName: string
  /** 貸出時点の料金のスナップショット。料金設定を後で変えても、この記録は変わらない */
  tariff: Tariff
  startAt: string | null
  endAt: string | null
  billedYen: number | null
}

export interface DirectExpenseRecord {
  id: string
  category: 'consumable' | 'repair' | 'communication' | 'other'
  amountYen: number
  memo: string
}

export interface SessionRecord extends Stamped {
  id: string
  status: 'draft' | 'active' | 'completed'
  departedAt: string
  returnedAt: string | null
  platform: Platform
  weather: Weather | null
  areaLabel: string
  revenueMode: 'summary'
  baseYen: number | null
  tipsYen: number | null
  completedCount: number | null
  /** クエスト・その他の調整（明細IDごとに1回だけ計上） */
  adjustments: { id: string; kind: 'quest' | 'other'; amountYen: number }[]
  summaryOnlineSeconds: number | null
  rentals: RentalRecord[]
  directExpenses: DirectExpenseRecord[]
  note: string
}

/** 毎月かかる固定費（通信・保険など）。開始月〜終了月の各月に計上する */
export interface RecurringExpenseRecord extends Stamped {
  id: string
  label: string
  category: 'communication' | 'insurance' | 'subscription' | 'other'
  amountYen: number
  startMonth: string
  endMonth: string | null
}

export interface PlanItemRecord {
  id: string
  label: string
  category: EquipmentCategory
  /** null は価格未設定（0円の無料とは別） */
  unitYen: number | null
  quantity: number
  state: 'planned' | 'purchased' | 'owned'
  businessRatioBps: number
  lifetimeMonths: number
  residualYen: number
  /** 購入済み・所有済みにした時に作った資産のID */
  assetId: string | null
}

export interface EquipmentPlanRecord extends Stamped {
  id: string
  name: string
  tier: 'beginner' | 'intermediate' | 'advanced' | 'custom'
  items: PlanItemRecord[]
}

export interface AssetRecord extends Stamped {
  id: string
  label: string
  category: EquipmentCategory
  sourcePlanItemId: string | null
  status: 'owned' | 'purchased'
  purchasedAt: string | null
  inServiceMonth: string
  unitYen: number
  quantity: number
  businessRatioBps: number
  managementValueYen: number | null
  residualYen: number
  lifetimeMonths: number
  soldAt: string | null
  businessSaleYen: number | null
}

export const WEATHER_LABELS: Record<Weather, string> = {
  clear: '☀️ 晴れ',
  cloudy: '☁️ くもり',
  light_rain: '🌦️ 小雨',
  heavy_rain: '🌧️ 本降り',
  hot: '🥵 猛暑',
  windy: '🌬️ 強風',
  snow: '❄️ 雪',
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  uber: 'Uber Eats',
  demaecan: '出前館',
  rocketnow: 'ロケットナウ',
  other: 'その他',
}

export const CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  vehicle: '🚲 車両',
  bag: '🎒 配達バッグ',
  helmet: '⛑️ ヘルメット',
  mount: '📱 スマホ固定具',
  battery: '🔋 モバイル電源',
  rainwear: '☔ 雨具',
  visibility: '🦺 視認性用品',
  other: '📦 その他',
}
