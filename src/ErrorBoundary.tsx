// 画面の表示中に思わぬ誤りが起きても、真っ白にせず、何が起きたかと直し方を出す（記録は端末に残っている）
import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <main className="card stack" role="alert" style={{ margin: 16 }}>
        <strong>⚠️ 画面を表示できませんでした</strong>
        <p>記録は端末に残っています。読み込み直すか、別の画面に移ってください。直らない時は、下の文をそのまま知らせてください。</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{error.message}</pre>
        <div className="actions">
          <button type="button" className="primary" onClick={() => location.reload()}>🔄 読み込み直す</button>
          <button
            type="button"
            onClick={() => {
              location.hash = '#home'
              this.setState({ error: null })
            }}
          >
            🏠 ホームへ
          </button>
        </div>
      </main>
    )
  }
}
