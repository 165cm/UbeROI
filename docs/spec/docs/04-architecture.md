# 04 技術仕様・構成案
## 方針
新規実装ならTypeScript + React + ViteのPWA、IndexedDB（Dexie等を候補）を提案する。これは本パッケージでの設計判断であり元会話の確定事項ではない。依存のバージョンは着手時に安定版と互換性を確認しlockfile固定。バックエンドなしでMVPが動く構成。

推奨分割:
- src/domain: money、intervals、tariffs、profitability、investment、planning。ブラウザーやLLMへの依存なしの純粋関数。
- src/storage: repositories、schema migrations、backup/import。
- src/features: dashboard、sessions、analytics、equipment、planning、settings。
- src/adapters: gbfs、weather、llm。取得失敗をResult型で返す。
- src/components: 金額、時間、状態ラベル、フォーム、アクセシブルな表/グラフ。

## ドメイン関数契約
calculateRental(input) -> {amountYen:number|null,status:estimated/actual/unsupported,nextIncreaseAt:string|null,reason?}
calculateSession(session,context) -> {revenueYen,costYen,operatingProfitYen,allocatedInvestmentYen,hours,hourlyYen:number|null,warnings:string[]}
calculatePeriod(range,records) -> {totals,unallocatedFixedCosts,unallocatedInvestment,excludedDrafts,calculationVersion}
calculateRecovery(cashEvents,asOf) -> {investedYen,cashSurplusYen,remainingYen,roi:number|null}
evaluateContinuation(stopNow,continueScenario,settings) -> {decision:GO/WAIT/STOP,reasons,deltaProfitYen,deltaHours,confidence}
関数は元データを変更しない。各返値には通貨・計算版を含める。

## 外部連携（MVP後）
GBFS: discovery JSONのfeedsからURLを解決し、特定URLの永続固定に依存しない。station_informationとstation_statusをprovider IDでjoin。ttlと取得元の利用条件に従う。期限切れの例: 現在時刻-observed_at > max(2*ttl,120秒)。古ければ推薦から除外し表示のみ。404/429/timeout/未知versionでは前回値を古いものとして表示、指数バックオフ。
天気: provider抽象化。利用規約、出典、頻度、タイムゾーンを実装時に確認。未接続でも手入力シナリオを利用可能。
Uber: 公開連携APIが使用可能と仮定しない。独自CSVがMVP。公式明細への個別対応は実ファイルの列と利用条件を確認して追加する。

## 任意バックエンド契約
LLMを入れる場合のみサーバーを設ける。
POST /api/coach/explain 入力: {requestId,calculationVersion,decision,kpis,reasons,dataQuality}、出力: {requestId,text,warnings,modelVersion}。個人住所・配達先・店名不要。最大入力32KB、timeout 15秒を提案値とする。400入力不正、429制限、503一時障害。失敗時はルールの説明を表示。
クライアントにAPIキーを置かない。無認証の公開LLMプロキシを作らず認証とレート制限、日次費用上限を設ける。LLMレスポンスは構造検証後にテキスト表示、HTML実行しない。

## 永続化とPWA
記録変更はトランザクションで保存。読み書き失敗と容量不足を可視化。Service Workerはアプリ本体をキャッシュし、外部空き情報を無期限キャッシュしない。更新時に未保存フォームを破棄しない。
タイマーはsetIntervalのカウントを正本にしない。タブ休止・再起動後も日時差で復元。通知は許可任意、バックグラウンドで必ず正確に発火する前提にしない。
IndexedDBは端末消去で失われるので、バックアップの導線と最終日時を常設。暗号化済みと誤表示しない。MVPには外部へのデータ送信なし、任意AI利用時には送信内容を設定画面で説明し無効化可能。

## 非機能受入目標
主要操作は一般的なスマートフォンで1000セッションのローカル集計が1秒以内を目安として計測。フォーム応答に長時間処理を挟まない。390px/320pxで横スクロールなし（データ表のみ明示横スクロール可）。日本語、JPY、Asia/Tokyo。Chrome Android/Safari iOSを対象に手動確認。テストはVitest等の単体、Playwright等の重要E2Eを提案し、採用ツールと対象ブラウザーの版を実装時に記録する。
