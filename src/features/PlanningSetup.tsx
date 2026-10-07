import { useState } from 'react'
import { AVAILABILITY_PRESETS } from '../domain'
import { IntInput, Problems, Select, errorMessages } from '../components/fields'
import { useData } from '../storage/context'
import { saveSettings } from '../storage/repo'
import type { SettingsRecord, TariffRecord } from '../storage/schema'

/** 未設定を暗黙の長時間稼働にせず、既存の設定項目で条件を決める。 */
export function PlanningSetup({ settings, tariffs }: { settings?: SettingsRecord; tariffs: TariffRecord[] }) {
  const { db } = useData()
  const [hours, setHours] = useState<number | null>(null)
  const [target, setTarget] = useState<number | null>(null)
  const [tariff, setTariff] = useState('')
  const [preset, setPreset] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  if (!settings) return null
  if (settings.weeklyBudgetMinutes !== null) {
    const missing = [settings.targetHourlyYen === null && '目標時給', !settings.availability && '働ける曜日・時間', !settings.defaultTariffId && '利用する料金'].filter(Boolean)
    return missing.length ? <aside className="card"><p>仮の条件：{missing.join('・')}が未設定です。</p><p className="hint">{!settings.availability && '時間帯は毎日9〜24時。'}{!settings.defaultTariffId && '料金は一覧の先頭を使います。'}{settings.targetHourlyYen === null && '目標時給がなければ利益の合計を優先します。'}</p><a href="#settings">条件を確認する</a></aside> : null
  }
  return (
    <form className="card stack" aria-label="計画の初期設定" onSubmit={async (e) => {
      e.preventDefault()
      if (saving) return
      if (hours === null || hours < 0 || (target ?? settings.targetHourlyYen) === null || !(tariff || settings.defaultTariffId) || (!preset && !settings.availability)) {
        setProblems(['週の時間・目標時給・料金・働ける時間を選んでください（今週休む場合は0時間）。'])
        return
      }
      setSaving(true)
      try {
        await saveSettings(db, { weeklyBudgetMinutes: hours * 60, targetHourlyYen: target ?? settings.targetHourlyYen, defaultTariffId: tariff || settings.defaultTariffId, availability: AVAILABILITY_PRESETS.find((p) => p.key === preset)?.days ?? settings.availability })
      } catch (err) { setProblems(errorMessages(err)) }
      finally { setSaving(false) }
    }}>
      <h3>まず、働ける条件を決めましょう</h3>
      <p className="hint">入力するまで自動の作戦は出しません。記録と手動の候補追加はそのまま使えます。</p>
      <IntInput label="計画に使う週の時間" unit="時間" value={hours} onChange={setHours} />
      <IntInput label="計画の目標時給" unit="円/時" value={target ?? settings.targetHourlyYen} onChange={setTarget} />
      <Select label="利用する自転車・料金" value={tariff || settings.defaultTariffId || ''} options={[{ value: '', label: '選んでください' }, ...tariffs.map((t) => ({ value: t.id, label: t.name }))]} onChange={setTariff} />
      <Select label="働ける時間帯" value={preset} options={[{ value: '', label: settings.availability ? '設定済みの時間を使う' : '選んでください' }, ...AVAILABILITY_PRESETS.map((p) => ({ value: p.key, label: p.label }))]} onChange={setPreset} />
      <p className="hint">料金は地域・車種に合うか確認してください。曜日ごとの調整は設定で変更できます。</p>
      <Problems items={problems} />
      <button className="primary" type="submit" disabled={saving}>{saving ? '保存中…' : '条件を保存して提案を見る'}</button>
    </form>
  )
}
