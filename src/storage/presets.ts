// 料金と装備のプリセット。どれも「例」で、利用者が選んで編集する（特定の地域を既定値にしない）
import { HELLO_TOKYO_CITY, type EquipmentCategory, type Tariff } from '../domain'

export interface TariffPreset {
  key: string
  name: string
  tariff: Tariff
  sourceUrl: string | null
  verifiedAt: string | null
  note: string
}

export const TARIFF_PRESETS: TariffPreset[] = [
  {
    key: 'hello-tokyo-city',
    name: 'HELLO CYCLING 東京都シティサイクル（例）',
    tariff: HELLO_TOKYO_CITY,
    sourceUrl: 'https://www.hellocycling.jp/price/tokyo/',
    verifiedAt: '2026-10-05',
    note: '最初の30分160円、以後15分160円、12時間まで上限2,500円',
  },
  {
    key: 'noll-pass',
    name: 'NOLL 時間パス・東京広域（例）',
    tariff: {
      kind: 'pass',
      passes: [
        { minutes: 180, yen: 900 },
        { minutes: 360, yen: 1500 },
        { minutes: 720, yen: 2500 },
      ],
    },
    sourceUrl: 'https://www.itmedia.co.jp/news/article/2603/03/1260303144/',
    verifiedAt: null,
    note: '3時間900円・6時間1,500円・12時間2,500円（報道ベース。公式で確認）',
  },
  {
    key: 'own-bike',
    name: '自分の自転車・月額サブスク',
    tariff: { kind: 'none' },
    sourceUrl: null,
    verifiedAt: null,
    note: '貸出ごとの料金なし。購入費は「装備と投資」、月額は「固定費」に登録',
  },
]

export interface EquipmentPresetItem {
  label: string
  category: EquipmentCategory
  lifetimeMonths: number
}

/**
 * 3段階は代替案。安全装備を上位専用にせず、同じカテゴリの品質・耐久を上げる。
 * 車両はどの段階でも別に追加できる（VEHICLE_PRESET）
 */
const BASE_CATEGORIES: EquipmentPresetItem[] = [
  { label: '保温配達バッグ', category: 'bag', lifetimeMonths: 24 },
  { label: 'ヘルメット', category: 'helmet', lifetimeMonths: 36 },
  { label: 'スマホ固定具', category: 'mount', lifetimeMonths: 24 },
  { label: 'モバイル電源', category: 'battery', lifetimeMonths: 24 },
  { label: '雨具', category: 'rainwear', lifetimeMonths: 12 },
  { label: '反射材・ライト', category: 'visibility', lifetimeMonths: 24 },
]

export const EQUIPMENT_PRESETS: Record<'beginner' | 'intermediate' | 'advanced', { name: string; items: EquipmentPresetItem[] }> = {
  beginner: { name: '初級', items: BASE_CATEGORIES },
  intermediate: {
    name: '中級',
    items: [
      ...BASE_CATEGORIES.map((i) => ({ ...i, label: `${i.label}（耐久・防水）` })),
      { label: '予備ケーブル', category: 'other', lifetimeMonths: 12 },
    ],
  },
  advanced: {
    name: '上級',
    items: [
      ...BASE_CATEGORIES.map((i) => ({ ...i, label: `${i.label}（長時間向け）`, lifetimeMonths: i.lifetimeMonths + 12 })),
      { label: '予備バッグ', category: 'bag', lifetimeMonths: 24 },
    ],
  },
}

export const VEHICLE_PRESET: EquipmentPresetItem = { label: '電動アシスト自転車', category: 'vehicle', lifetimeMonths: 36 }
