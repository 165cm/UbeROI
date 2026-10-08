import { Icon } from './Icon'
// 入力欄の共通部品。金額は整数円、空欄は「未設定」（null）として0と区別する
import { Children, useEffect, useId, useState, type ReactNode } from 'react'

/**
 * 毎回読まなくていい説明。ⓘ を押した時だけ開く（UI_RULES「文字は最小限」）。
 * 閉じていても文章は残し、id で入力欄や見出しから読み上げに結びつけられる
 */
export function Tip({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  const [open, setOpen] = useState(false)
  const autoId = useId()
  const bodyId = id ?? `${autoId}-tip`
  return (
    <span className="tip">
      <button type="button" className="tip-button" aria-label={`${label}の説明`} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
        ⓘ
      </button>
      <span id={bodyId} className="tip-body" role="note" hidden={!open}>
        {children}
      </span>
    </span>
  )
}

/** 見出しの文字だけを取り出す（ⓘ の読み上げ名に使う） */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return ''
}

/** カードの見出し。説明は ⓘ に入れ、見出しの右に置く */
export function CardTitle({ id, children, tip, right }: { id?: string; children: ReactNode; tip?: ReactNode; right?: ReactNode }) {
  return (
    <div className="card-title">
      <h3 id={id}>{Children.toArray(children).map((child, i) => {
        if (i !== 0 || typeof child !== 'string') return child
        const mark = child.match(/^[\p{Extended_Pictographic}\uFE0F\s]+/u)?.[0]
        if (!mark?.trim()) return child
        const name = /📊|📈|🧮/.test(mark) ? 'analytics' : /💰|💴/.test(mark) ? 'coins' : /📅|🗓/.test(mark) ? 'plan' : 'document'
        return <span className="title-label" key="title"><Icon name={name} /><span className="visually-hidden">{mark}</span>{child.slice(mark.length)}</span>
      })}</h3>
      {tip && <Tip label={textOf(children).replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '').trim() || '見出し'}>{tip}</Tip>}
      {right && <span className="card-title-right">{right}</span>}
    </div>
  )
}

/**
 * ラベルと説明つきの入力欄。
 * - hint：いつも見せる説明（入力の誤り・計算した値など、今の状態で変わるもの）
 * - tip：毎回読まなくていい説明（ⓘ の中）
 * どちらも aria-describedby で入力欄に結びつけ、読み上げソフトでは欄と一緒に読まれる
 */
export function Field({ label, hint, tip, children }: { label: string; hint?: string; tip?: string; children: (id: string, describedBy: string | undefined) => ReactNode }) {
  const id = useId()
  const hintId = `${id}-hint`
  const tipId = `${id}-tip`
  const describedBy = [hint ? hintId : null, tip ? tipId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <span className="field-label">
        <label htmlFor={id}>{label}</label>
        {tip && <Tip label={label} id={tipId}>{tip}</Tip>}
      </span>
      {children(id, describedBy)}
      {hint && <p id={hintId} className="hint" aria-live="polite">{hint}</p>}
    </div>
  )
}

/** 整数の入力。空欄は null。数字以外・小数は受け付けない */
export function IntInput({
  label,
  value,
  onChange,
  hint,
  tip,
  unit,
  allowNegative = false,
  placeholder = '未設定',
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  hint?: string
  tip?: string
  unit?: string
  allowNegative?: boolean
  placeholder?: string
}) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    // 外から値が変わった時だけ表示を合わせる（入力途中の文字は消さない）
    setText((current) => {
      const parsed = current === '' ? null : Number(current)
      return parsed === value ? current : value === null ? '' : String(value)
    })
  }, [value])
  return (
    <Field label={label} hint={error ?? hint} tip={tip}>
      {(id, describedBy) => (
        <div className="input-unit" data-unit={unit}>
          <input
            id={id}
            aria-describedby={describedBy}
            inputMode={allowNegative ? 'text' : 'numeric'}
            value={text}
            placeholder={placeholder}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              const raw = e.target.value.replace(/[,，\s]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
              setText(raw)
              if (raw === '') {
                setError(null)
                onChange(null)
                return
              }
              const ok = allowNegative ? /^-?\d+$/.test(raw) : /^\d+$/.test(raw)
              const n = Number(raw)
              if (!ok || !Number.isSafeInteger(n)) {
                setError(allowNegative ? '整数で入力してください' : '0以上の整数で入力してください')
                return
              }
              setError(null)
              onChange(n)
            }}
          />
          {unit && <span aria-hidden="true">{unit === '円' ? '¥' : unit}</span>}
        </div>
      )}
    </Field>
  )
}

export function TextInput({ label, value, onChange, hint, tip, placeholder }: { label: string; value: string; onChange: (v: string) => void; hint?: string; tip?: string; placeholder?: string }) {
  return (
    <Field label={label} hint={hint} tip={tip}>
      {(id, describedBy) => <input id={id} aria-describedby={describedBy} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  )
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  tip,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  hint?: string
  tip?: string
}) {
  return (
    <Field label={label} hint={hint} tip={tip}>
      {(id, describedBy) => (
        <select id={id} aria-describedby={describedBy} value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

/** 端末の時刻での日時入力 ⇔ ISO（UTC）。保存はUTC、表示は端末の時刻 */
export function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 端末の時刻での今日 YYYY-MM-DD（UTCの日付ではない） */
export function localToday(): string {
  return toLocalInput(new Date().toISOString()).slice(0, 10)
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function DateTimeInput({ label, value, onChange, hint, tip }: { label: string; value: string | null; onChange: (iso: string | null) => void; hint?: string; tip?: string }) {
  return (
    <Field label={label} hint={hint} tip={tip}>
      {(id, describedBy) => <input id={id} aria-describedby={describedBy} type="datetime-local" value={toLocalInput(value)} onChange={(e) => onChange(fromLocalInput(e.target.value))} />}
    </Field>
  )
}

export function Problems({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="problems" role="alert">
      <strong>⚠️ 確認してください</strong>
      <ul>
        {items.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  )
}

/** 押した場所の近くに出す結果表示。取り消せる操作には「↩ 元に戻す」 */
export function Notice({ message, onUndo, onClose }: { message: string; onUndo?: () => void; onClose: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onClose, 8000)
    return () => window.clearTimeout(t)
  }, [onClose])
  return (
    <div className="notice" role="status">
      <span>{message}</span>
      {onUndo && (
        <button type="button" className="link" onClick={onUndo}>
          ↩ 元に戻す
        </button>
      )}
    </div>
  )
}

export function errorMessages(e: unknown): string[] {
  // 端末の保存容量が足りない時（Dexie は内側のエラーを inner に持つ）
  const name = (e as { name?: string; inner?: { name?: string } } | null)?.name
  const innerName = (e as { inner?: { name?: string } } | null)?.inner?.name
  if (name === 'QuotaExceededError' || innerName === 'QuotaExceededError') {
    return ['端末の保存容量が足りないため保存できませんでした。バックアップを書き出し、不要な写真やアプリを消してから、もう一度試してください']
  }
  if (e && typeof e === 'object' && 'problems' in e && Array.isArray((e as { problems: unknown }).problems)) {
    return (e as { problems: string[] }).problems
  }
  return [e instanceof Error ? e.message : '保存できませんでした。もう一度試してください']
}
