import { useEffect, useState } from 'react'
import { DataProvider, useData } from './storage/context'
import { Analytics } from './features/Analytics'
import { Home } from './features/Home'
import { Plan } from './features/Plan'
import { Records } from './features/Records'
import { Settings } from './features/Settings'
import { applyUpdate, useOnline, usePwa } from './pwa'

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

export function App() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}

function Shell() {
  const { mode } = useData()
  const online = useOnline()
  const { updateReady } = usePwa()
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
        {!online && (
          <span className="tag" role="status" title="電波がなくても記録できます（端末に保存されます）">
            📴 オフライン・記録できます
          </span>
        )}
      </header>
      {updateReady && (
        <div className="update-banner" role="status">
          <span>🔄 新しい版があります（入力中なら保存してから）</span>
          <button type="button" className="primary" onClick={applyUpdate}>
            更新する
          </button>
        </div>
      )}
      {mode === 'demo' && (
        <p className="demo-banner" role="status">
          🧪 デモ表示中（合成データ・実績ではない）
        </p>
      )}
      <main className="app-main" aria-labelledby="page-title">
        {/* 画面の名前は下のメニューで分かるので、見た目では出さず読み上げ用に残す */}
        <h2 id="page-title" className="visually-hidden">{active.label}</h2>
        {tab === 'home' && (
          <Home
            onSettle={(id) => {
              setEditId(id)
              window.location.hash = 'records'
            }}
          />
        )}
        {tab === 'records' && <Records editId={editId} onEdit={setEditId} />}
        {tab === 'analytics' && <Analytics />}
        {tab === 'settings' && <Settings />}
        {tab === 'plan' && <Plan />}
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
