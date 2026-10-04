// 画面からデータベースを使うための入口（実績／デモの切り替えを含む）
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getDb, loadMode, saveMode, type DataMode, type DeliKanDB } from './db'
import { ensureInitialData } from './repo'
import { seedDemo } from './demo'

interface DataContextValue {
  db: DeliKanDB
  mode: DataMode
  setMode: (mode: DataMode) => void
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DataMode>(loadMode)
  const [ready, setReady] = useState<DataMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const db = getDb(mode)

  useEffect(() => {
    let cancelled = false
    setError(null)
    ensureInitialData(db)
      .then(() => (mode === 'demo' ? seedDemo(db) : undefined))
      .then(() => !cancelled && setReady(mode))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [db, mode])

  const setMode = (next: DataMode) => {
    saveMode(next)
    setModeState(next)
  }

  if (error) {
    return (
      <div className="card problems" role="alert">
        <strong>⚠️ 端末の保存領域を開けませんでした</strong>
        <p>{error}</p>
        <p className="hint">プライベートブラウズや容量不足の時に起きます。通常の画面で開き直してください。</p>
      </div>
    )
  }
  if (ready !== mode) return <p className="loading">読み込み中…</p>
  return <DataContext.Provider value={{ db, mode, setMode }}>{children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const v = useContext(DataContext)
  if (!v) throw new Error('DataProvider の外で使われています')
  return v
}
