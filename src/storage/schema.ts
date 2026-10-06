// 端末に保存するデータの形（docs/spec/docs/03-data-model.md を MVP 向けに簡略化）
// 子レコード（レンタル・調整・直接経費）はセッションの中に持ち、1回の書き込みでまとめて保存・削除する
import type { BusynessTable, EquipmentCategory, OfferDecision, Platform, Tariff } from '../domain'

/**
 * 2：計画の候補枠（slots）を追加。3：クエスト（quests）を追加。4：記録に取り込み元（imported）を追加。
 * 5：エリアの混み具合（areas）と、設定の主なエリア（primaryAreaId）を追加。
 * 6：オファーの記録（offers）と、設定のオファー判定の基準（offerBufferMinutes・offerMinKmYen）を追加。
 * 古い版のバックアップは、足りない一覧を空・取り込み元なし（手入力）として読み込む
 */
export const SCHEMA_VERSION = 8

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
  /** 最後にバックアップを書き出した日時（未実施なら null／未定義） */
  lastBackupAt?: string | null
  /** 見込みに使う主なエリア（areas の id。未設定なら null／未定義） */
  primaryAreaId?: string | null
  /** オファー判定：オファーの分数に足す余裕（待ち時間など、分）。未定義は既定値 */
  offerBufferMinutes?: number
  /** オファー判定：km単価の下限（任意。null／未定義は使わない） */
  offerMinKmYen?: number | null
  /** オファー判定を使うか（手入力。版8で追加。未定義は使わない） */
  offerJudgeEnabled?: boolean
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
  /** CSVから取り込んだ記録の出どころ。手入力の記録は無い（または null） */
  imported?: ImportedFrom | null
}

/** 取り込み元の行。同じ externalId で中身（fingerprint）が違う行は、黙って上書きせず競合として止める */
export interface ImportedFrom {
  source: 'csv-v1'
  externalId: string
  fingerprint: string
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

/** 計画の候補枠（仕様 AvailabilitySlot）。帰宅までの拘束時間を持つ。実績には入らない */
export interface SlotRecord extends Stamped {
  id: string
  startsAt: string
  endsAt: string
  areaLabel: string
  /** シナリオごとの売上見込み（整数円）。null は未入力 */
  revenueYen: { pessimistic: number | null; standard: number | null; optimistic: number | null }
  /** 見込みの出どころ（推計・自分の実績・手入力） */
  estimateNote: string
  /** 想定レンタル代。null は「料金から自動で見積もる」 */
  rentalOverrideYen: number | null
  expenseYen: number
  tariffId: string | null
}

/** クエスト（見込みの管理用）。達成して確定した額は、精算の「確定したクエスト」に入れる */
export interface QuestRecord extends Stamped {
  id: string
  label: string
  /** 対象のサービス（このサービスの確定記録の件数を数える） */
  platform: Platform
  startsAt: string
  endsAt: string
  rewardMode: 'cumulative' | 'incremental'
  tiers: { count: number; rewardYen: number }[]
  manualOffset: number
}

/**
 * エリアの混み具合（配達アプリの「時間帯ごとの傾向」を利用者が見て写したもの）。
 * 段階は「そのエリアの中での比較」で、時給そのものではない。見込みの倍率としてだけ使う
 */
export interface AreaRecord extends Stamped {
  id: string
  /** 例：中野・荻窪エリア */
  name: string
  /** 7曜日（0=日）× 24時間。0 は未入力、1〜4 は空き〜混む（4時〜翌3時で1日） */
  levels: BusynessTable
  /** このエリアに入る地名（オファー判定で届け先の地名からエリアを探す） */
  towns: string[]
  /** 配達アプリで確かめた日 YYYY-MM-DD（1か月たったら見直しを知らせる） */
  checkedAt: string
  /** 主なエリアからこのエリアへの移動の分（終了までの見通しで「移動」を候補にする。版7で追加。未設定なら候補にしない） */
  moveMinutes?: number | null
  /** 移動の分をどのエリア（その時の主なエリア）から測ったか。主なエリアが変わったら、その分は使わない（版7で追加） */
  moveFromAreaId?: string | null
}

/**
 * オファーの記録（受けた／断った）。地名と時刻から、届け先の有利さを学ぶのに使う（MVP後 4）。
 * 住所は保存しない（地名まで）
 */
export interface OfferRecord extends Stamped {
  id: string
  /** オファーを見た時刻 */
  at: string
  payYen: number
  minutes: number
  km: number | null
  /** 見つかった地名とエリア（なければ null） */
  town: string | null
  areaName: string | null
  /** アプリの判定 */
  decision: OfferDecision
  hourlyYen: number | null
  /** 利用者がどうしたか */
  outcome: 'accepted' | 'declined'
}
