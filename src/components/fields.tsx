// 入力欄の共通部品。金額は整数円、空欄は「未設定」（null）として0と区別する
import { useEffect, useId, useState, type ReactNode } from 'react'

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

/** 整数の入力。空欄は null。数字以外・小数は受け付けない */
export function IntInput({
  label,
  value,
  onChange,
  hint,
  unit,
  allowNegative = false,
  placeholder = '未設定',
}: {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  hint?: string
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
    <Field label={label} hint={error ?? hint}>
      {(id) => (
        <div className="input-unit">
          <input
            id={id}
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
          {unit && <span aria-hidden="true">{unit}</span>}
        </div>
      )}
    </Field>
  )
}

export function TextInput({ label, value, onChange, hint, placeholder }: { label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => <input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  )
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  hint?: string
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
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

export function DateTimeInput({ label, value, onChange, hint }: { label: string; value: string | null; onChange: (iso: string | null) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => <input id={id} type="datetime-local" value={toLocalInput(value)} onChange={(e) => onChange(fromLocalInput(e.target.value))} />}
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
  if (e && typeof e === 'object' && 'problems' in e && Array.isArray((e as { problems: unknown }).problems)) {
    return (e as { problems: string[] }).problems
  }
  return [e instanceof Error ? e.message : '保存できませんでした。もう一度試してください']
}
