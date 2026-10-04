// 「ホーム画面に追加」の案内と、端末の保存を消えにくくする状態の表示
import { useEffect, useState } from 'react'
import { isIos, isStandalone, promptInstall, requestPersistentStorage, usePwa } from '../pwa'

export function InstallHelp() {
  const { canInstall } = usePwa()
  const [persisted, setPersisted] = useState<boolean | null | undefined>(undefined)

  useEffect(() => {
    void requestPersistentStorage().then(setPersisted)
  }, [])

  return (
    <section className="card stack">
      <h3>📲 アプリとして使う</h3>
      {isStandalone() ? (
        <p>✅ ホーム画面から開いています。電波がなくても開けます。</p>
      ) : (
        <>
          <p className="hint">ホーム画面に追加すると、普通のアプリのように開けて、電波がない場所でも使えます。</p>
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
        </>
      )}
      <p className="hint">
        端末の保存：
        {persisted === undefined
          ? '確認中…'
          : persisted === true
            ? '🔒 消えにくい保存になっています'
            : persisted === false
              ? '通常の保存です（容量が足りない時にブラウザーが消すことがあります。ホーム画面に追加すると消えにくくなります）'
              : 'この端末では確かめられません'}
      </p>
    </section>
  )
}
