import { useEffect, useState } from 'react'
import { RentalChecker } from './features/RentalChecker'

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

const EMPTY_STATES: Record<Exclude<TabId, 'home'>, { title: string; body: string }> = {
  records: { title: '稼働の記録', body: '出発・帰宅・売上・レンタル代を記録する画面です。次の更新で使えるようになります。' },
  analytics: { title: '分析', body: '日・週・月の利益、本当の時給、投資の回収を見る画面です。記録ができたら表示します。' },
  plan: { title: '計画', body: '空き時間の候補を比べ、悲観／標準／楽観で見込みを出す画面です。準備中です。' },
  settings: { title: '設定', body: '起点・目標時給・料金・装備（初級／中級／上級）を登録する画面です。準備中です。' },
}

export function App() {
  const [tab, setTab] = useState<TabId>(currentTab)

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
        <span className="origin">📍 千歳烏山駅周辺</span>
      </header>
      <main className="app-main" aria-labelledby="page-title">
        <h2 id="page-title" className="visually-hidden">
          {active.label}
        </h2>
        {tab === 'home' ? (
          <>
            <RentalChecker />
            <section className="card muted">
              <h3>今日の収益</h3>
              <p>まだ記録がありません。記録画面ができたら、ここに営業純時給と投資配賦後の時給が出ます。</p>
            </section>
          </>
        ) : (
          <section className="card muted">
            <h3>{EMPTY_STATES[tab].title}</h3>
            <p>{EMPTY_STATES[tab].body}</p>
          </section>
        )}
      </main>
      <nav className="tabbar" aria-label="メニュー">
        {TABS.map((t) => (
          <a key={t.id} href={`#${t.id}`} aria-current={t.id === tab ? 'page' : undefined}>
            <span aria-hidden="true">{t.icon}</span>
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  )
}
