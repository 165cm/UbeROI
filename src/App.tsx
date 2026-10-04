import { useEffect, useState } from 'react'
import { DataProvider, useData } from './storage/context'
import { Home } from './features/Home'
import { Records } from './features/Records'
import { Settings } from './features/Settings'

const TABS = [
  { id: 'home', label: 'ホーム', icon: '🏠' },
  { id: 'records', label: '記録', icon: '📝' },
  { id: 'analytics', label: '分析', icon: '📊' },
  { id: 'plan', label: '計画', icon: '🗓️' },
  { id: 'settings', label: '設定', icon: '⚙️' },
] as const

type TabId = (typeof TABS)[number]['id']

function currentTab(): TabId {
  const hash = window.location.hash.replace('#', '')
  return TABS.some((t) => t.id === hash) ? (hash as TabId) : 'home'
}

const COMING_SOON: Record<'analytics' | 'plan', { title: string; body: string }> = {
  analytics: { title: '分析', body: '日・週・月の利益、本当の時給、投資の回収曲線を見る画面です。次の更新で追加します。今月の成績はホームに出ています。' },
  plan: { title: '計画', body: '空き時間の候補を比べ、悲観／標準／楽観で見込みを出す画面です。準備中です。' },
}

export function App() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}

function Shell() {
  const { mode } = useData()
  const [tab, setTab] = useState<TabId>(currentTab)
  const [editId, setEditId] = useState<string | null>(null)

  useEffect(() => {
    const onHash = () => setTab(currentTab())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const active = TABS.find((t) => t.id === tab)!

  return (
    <div className="app">
      <header className="app-header">
        <h1>デリ勘</h1>
      </header>
      {mode === 'demo' && (
        <p className="demo-banner" role="status">
          🧪 デモ表示中（合成データ・実績ではありません）
        </p>
      )}
      <main className="app-main" aria-labelledby="page-title">
        <h2 id="page-title">{active.label}</h2>
        {tab === 'home' && (
          <Home
            onSettle={(id) => {
              setEditId(id)
              window.location.hash = 'records'
            }}
          />
        )}
        {tab === 'records' && <Records editId={editId} onEdit={setEditId} />}
        {tab === 'settings' && <Settings />}
        {(tab === 'analytics' || tab === 'plan') && (
          <section className="card muted">
            <h3>{COMING_SOON[tab].title}</h3>
            <p>{COMING_SOON[tab].body}</p>
          </section>
        )}
      </main>
      <nav className="tabbar" aria-label="メニュー">
        {TABS.map((t) => (
          <a key={t.id} href={`#${t.id}`} aria-current={t.id === tab ? 'page' : undefined} onClick={() => t.id !== 'records' && setEditId(null)}>
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  )
}
