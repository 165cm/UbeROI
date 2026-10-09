import { useEffect, useRef, useState } from 'react'
import { BUSINESS_HOURS, WEEKDAY_LABELS, readBusyChart, type BusynessTable } from '../domain'
import { localToday } from '../components/fields'

const DAYS = [1, 2, 3, 4, 5, 6, 0]
interface Shot {
  name: string
  url: string
  chartUrl: string | null
  levels: number[]
  weekday: number
  detected: boolean
  failed: boolean
  uncertain: number[]
  include: boolean
  reviewed: boolean
}
export interface ReviewedDay { weekday: number; levels: number[] }

async function readImage(file: File) {
  const bitmap = await createImageBitmap(file)
  try {
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * ratio)
    canvas.height = Math.round(bitmap.height * ratio)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const reading = readBusyChart(context.getImageData(0, 0, canvas.width, canvas.height))
    if (!reading) return null
    const { x, y, width, height } = reading.bounds
    const crop = document.createElement('canvas'); crop.width = width; crop.height = height
    crop.getContext('2d')!.drawImage(canvas, x, y, width, height, 0, 0, width, height)
    return { ...reading, chartUrl: crop.toDataURL('image/png') }
  } finally { bitmap.close() }
}

/** 元画像はメモリー内だけ。確認後に選んだ曜日を更新し、未読セルは既存値を維持する。 */
export function BusyScreenshotImport({ current, onApply }: {
  current: BusynessTable
  onApply: (days: ReviewedDay[], checkedAt: string) => void
}) {
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [date, setDate] = useState(localToday)
  const [message, setMessage] = useState('')
  const urls = useRef<string[]>([])
  const generation = useRef(0)
  const release = () => { urls.current.forEach(URL.revokeObjectURL); urls.current = [] }
  useEffect(() => () => { generation.current++; release() }, [])
  const patch = (index: number, value: Partial<Shot>) => setShots(rows => rows.map((r, i) => i === index ? { ...r, ...value } : r))
  const selected = shots.filter(r => r.include)
  const chosenDays = selected.filter(r => r.weekday >= 0).map(r => r.weekday)
  const duplicate = new Set(chosenDays).size !== chosenDays.length
  const ready = selected.length > 0 && !duplicate && selected.every(r => r.reviewed && r.weekday >= 0 && r.levels.every(v => v > 0)) && !!date && date <= localToday()
  return <div className="stack screenshot-review">
    <label className="button-link">
      📷 スクショから読み取る
      <input type="file" accept="image/*" multiple disabled={busy} className="visually-hidden" onChange={async e => {
        const files = [...(e.target.files ?? [])]; e.target.value = ''
        if (!files.length) return
        if (files.length > 7) { setMessage('一度に選べる画像は7枚までです。'); return }
        const token = ++generation.current
        release(); setShots([]); setBusy(true); setMessage('')
        const results: Shot[] = []
        for (const file of files) {
          if (token !== generation.current) return
          const url = URL.createObjectURL(file); urls.current.push(url)
          let reading = null
          try { reading = await readImage(file) } catch { /* 手入力で補える */ }
          results.push({ name: file.name, url, chartUrl: reading?.chartUrl ?? null, levels: reading?.levels ?? Array(24).fill(0), weekday: reading?.weekday ?? -1,
            detected: reading?.weekday != null, failed: !reading, uncertain: reading?.uncertain ?? [], include: !!reading, reviewed: false })
        }
        if (token === generation.current) { setShots(results); setBusy(false) }
      }} />
    </label>
    <p className="hint">曜日ごとの画像を最大7枚選べます。画像は端末内で処理し、保存・送信しません。読み取り後は元画像と見比べて修正してください。</p>
    {busy && <p role="status">読み取り中…</p>}
    {message && <p role="status">{message}</p>}
    {shots.length > 0 && <>
      <label className="field"><span>今回の情報を確認した日</span><input type="date" value={date} max={localToday()} onChange={e => { setDate(e.target.value); setShots(rows => rows.map(r => ({ ...r, reviewed: false }))) }} /></label>
      {shots.map((r, i) => <section className="subcard stack" key={r.url} aria-label={`${i + 1}枚目の確認`}>
        <strong>{i + 1}枚目：{r.name}</strong>
        <label className="line"><input className="check" type="checkbox" checked={r.include} onChange={e => patch(i, { include: e.target.checked, reviewed: false })} />この画像を更新に使う</label>
        {r.chartUrl && <img className="shot-original shot-chart" src={r.chartUrl} alt={`${i + 1}枚目の棒グラフ（元画像から拡大）`} />}
        <details open={!r.chartUrl}><summary>元画像を大きく見る</summary><a href={r.url} target="_blank" rel="noreferrer"><img className="shot-original" src={r.url} alt={`${i + 1}枚目の元画像`} /></a><p className="hint">画像を押すと別画面で拡大できます。</p></details>
        {r.failed && <p role="status">棒グラフを読めませんでした。元画像を見て24時間の値を入力できます。</p>}
        {r.uncertain.length > 0 && <p className="hint">要確認：{r.uncertain.map(h => `${BUSINESS_HOURS[h]}時`).join('・')}</p>}
        <label className="field"><span>曜日{r.detected ? '（自動判定・要確認）' : '（選択してください）'}</span>
          <select aria-label={`${i + 1}枚目の曜日`} value={r.weekday} onChange={e => patch(i, { weekday: Number(e.target.value), reviewed: false })}>
            <option value={-1}>曜日を選択</option>{DAYS.map(d => <option key={d} value={d}>{WEEKDAY_LABELS[d]}曜</option>)}
          </select>
        </label>
        <div className="mini-bars" role="img" aria-label={`${i + 1}枚目：${r.levels.join('')}`}>{r.levels.map((v, h) => <span key={h} className={`level-${v}`} style={{ height: `${v * 25}%` }} />)}</div>
        <p className="hint">4時〜翌3時。旧→新を確認し、違う値は直接選び直してください。</p>
        <div className="shot-values">
          {r.levels.map((value, h) => {
            const hour = BUSINESS_HOURS[h]!
            const old = r.weekday < 0 ? null : current[r.weekday]![hour]!
            return <label className={`field ${old !== null && old !== value ? 'shot-changed' : ''}`} key={h}>
              <span>{hour < 4 ? '翌' : ''}{hour}時 <small>{old === null ? '—' : old || '未'} → {value || '未'}</small></span>
              <select aria-label={`${i + 1}枚目 ${hour}時の段階`} value={value} onChange={e => patch(i, { levels: r.levels.map((v, k) => k === h ? Number(e.target.value) : v), reviewed: false })}>
                {['未入力', '1 空き', '2 やや空き', '3 やや混む', '4 混む'].map((name, v) => <option key={v} value={v}>{name}</option>)}
              </select>
            </label>
          })}
        </div>
        <label className="line"><input className="check" type="checkbox" checked={r.reviewed} disabled={r.weekday < 0 || r.levels.some(v => !v)} onChange={e => patch(i, { reviewed: e.target.checked })} />{i + 1}枚目の曜日と24時間の値を確認した</label>
      </section>)}
      {duplicate && <p role="alert">同じ曜日が2枚あります。曜日を直すか、使わない画像のチェックを外してください。</p>}
      <p className="hint">選んだ曜日だけを置き換えます。他の曜日は変わりません。「表に入れる」の後、エリアの「保存」で確定します。</p>
      <div className="buttons"><button type="button" className="primary" disabled={!ready} onClick={() => {
        onApply(selected.map(r => ({ weekday: r.weekday, levels: [...r.levels] })), date)
        setShots([]); release(); setMessage('表に反映しました。確認してエリアを保存してください。')
      }}>✅ {selected.length}曜日分を表に入れる</button><button type="button" onClick={() => { setShots([]); release() }}>読み取りをやめる</button></div>
    </>}
  </div>
}
