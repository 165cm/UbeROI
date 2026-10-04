// 表示用の整形。計算はしない（表示時だけ円を四捨五入する）
const yenFormat = new Intl.NumberFormat('ja-JP')

export function formatYen(value: number | null): string {
  return value === null ? '算出不可' : `${yenFormat.format(Math.round(value))}円`
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0 ? `${h}時間${m}分` : `${m}分${String(s).padStart(2, '0')}秒`
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
