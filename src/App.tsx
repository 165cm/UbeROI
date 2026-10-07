import { useEffect, useState } from 'react'
import { DataProvider, useData } from './storage/context'
import { Analytics } from './features/Analytics'
import { Home } from './features/Home'
import { Plan } from './features/Plan'
import { Records } from './features/Records'
import { OfferJudge } from './features/OfferJudge'
import { Settings } from './features/Settings'
import { applyUpdate, useOnline, usePwa } from './pwa'

const TABS = [
  { id: 'home', label: '今日', icon: '🏠' },
  { id: 'plan', label: '計画', icon: '🗓️' },
  { id: 'records', label: '記録', icon: '📝' },
  { id: 'analytics', label: '分析', icon: '📊' },
] as const

type TabId = (typeof TABS)[number]['id'] | 'offer' | 'settings'

/** 「#offer?text=…」のように、画面の名前の後ろに値が付くことがある（ショートカットから開く時） */
function currentTab(): TabId {
  const hash = window.location.hash.replace('#', '').split('?')[0]!
  if (hash === 'offer' || hash === 'settings') return hash
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
  // 「#offer?text=…」を続けて開いた時に、前の値のまま判定しないよう、ハッシュ全体で画面を作り直す
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const onHash = () => {
      setTab(currentTab())
      setHash(window.location.hash)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // オファー判定はホームから開く画面なので、下のメニューではホームを選んだ状態にする
  const active = TABS.find((t) => t.id === (tab === 'offer' ? 'home' : tab))

  return (
    <div className="app">
      <header className="app-header">
        <h1>デリ勘</h1>
        <a className="settings-link" href="#settings" aria-label="設定" aria-current={tab === 'settings' ? 'page' : undefined}>⚙️ 設定</a>
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
        {/* メニューに加え、画面の見出しでも現在地を示す */}
        <h2 id="page-title">{tab === 'offer' ? 'オファー判定' : tab === 'settings' ? '設定' : active?.label}</h2>
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
        {tab === 'offer' && <OfferJudge key={hash} />}
      </main>
      <nav className="tabbar" aria-label="メニュー">
        {TABS.map((t) => (
          <a key={t.id} href={`#${t.id}`} aria-current={t.id === active?.id ? 'page' : undefined} onClick={() => t.id !== 'records' && setEditId(null)}>
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  )
}
