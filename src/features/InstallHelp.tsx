// 「ホーム画面に追加」の案内と、端末の保存を消えにくくする状態の表示
import { useEffect, useState } from 'react'
import { isIos, isStandalone, promptInstall, requestPersistentStorage, usePwa } from '../pwa'

export function InstallHelp() {
  const { canInstall } = usePwa()
  const [persisted, setPersisted] = useState<boolean | null | undefined>(undefined)

  useEffect(() => {
    void requestPersistentStorage().then(setPersisted)
  }, [])

  const storage =
    persisted === undefined
      ? '確認中…'
      : persisted === true
        ? '🔒 消えにくい保存'
        : persisted === false
          ? '通常の保存'
          : '保存の状態は不明'

  // ホーム画面から開いている時は1行だけ。そうでなければ手順を畳んで出す
  if (isStandalone()) {
    return (
      <p className="card hint">
        ✅ アプリとして開いています・{storage}
      </p>
    )
  }
  return (
    <details className="card fold">
      <summary>
        <strong>📲 アプリとして使う</strong>
        <span className="hint">{storage}</span>
      </summary>
      <div className="stack">
        <p className="hint">ホーム画面に追加すると、普通のアプリのように開けて、電波がない場所でも使えます。保存も消えにくくなります（通常の保存は、容量が足りない時にブラウザーが消すことがあります）。</p>
        {canInstall && (
          <button type="button" className="primary" onClick={() => void promptInstall()}>
            📲 ホーム画面に追加する
          </button>
        )}
        {isIos() ? (
          <ol className="steps">
            <li>Safari でこのページを開く</li>
            <li>画面下の共有ボタン（□に↑）を押す</li>
            <li>「ホーム画面に追加」を選んで「追加」</li>
          </ol>
        ) : (
          !canInstall && (
            <ol className="steps">
              <li>Chrome でこのページを開く</li>
              <li>右上の「︙」メニューを押す</li>
              <li>「ホーム画面に追加」または「アプリをインストール」を選ぶ</li>
            </ol>
          )
        )}
      </div>
    </details>
  )
}
