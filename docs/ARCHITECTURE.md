# しくみ（ARCHITECTURE）

## 全体

```
スマホのブラウザ（PWA：React + TypeScript、Vite でビルド）
   │
   ▼
端末内の保存：IndexedDB（Dexie）
   └ 書き出し：JSONバックアップ・CSV（手動）／取り込み：独自CSV（v1）
```

- 公開URL：https://165cm.github.io/UbeROI/ （GitHub Pages）
- サーバーはなし。将来、AI説明などでサーバーが必要になったら Google Cloud（Cloud Run 等）に置く
- 詳しい技術仕様：`docs/spec/docs/04-architecture.md`

## ファイルの役割

| ファイル・フォルダ | 役割 |
|---|---|
| `src/domain/core.ts` | 金額の検査、0割りの扱い、区間の和集合、日本時間の日付・週・月、整数円の按分 |
| `src/domain/tariff.ts` | レンタル料金（段階料金・時間パス・自前車両）と次の課金時刻 |
| `src/domain/session.ts` | 稼働1回の売上・費用・営業純利益・各種時給 |
| `src/domain/investment.ts` | 装備・車両の現金投資、月ごとの配賦、投資回収 |
| `src/domain/period.ts` | 日・週・月などの期間損益（固定費・配賦を稼働へ配る） |
| `src/domain/equipment.ts` | 装備プラン（初級／中級／上級）の合計・必要な現金 |
| `src/domain/quest.ts` | 選択制クエストの期間、クエストの進み具合、休憩前の返却で節約できる額 |
| `src/domain/areaRoute.ts` | 時間帯ごとのエリア計画（正時で区切り、移動の分と1回200円を引いて、どの時間にどのエリアにいるかを選ぶ） |
| `src/domain/weekPlanner.ts` | 週の作戦エンジン（日ごとの候補：休み・1回・昼と夜の2回、レンタルの借りたまま／返す、ピークと日跨ぎの報酬、動的計画法で目標ごとの選択肢） |
| `src/domain/weather.ts` | 天気（晴れ・くもり・雨・荒天）：予報の1時間の判定、記録の天気のまとめ、日の代表、手で直した天気、雨の倍率 |
| `src/adapters/weather.ts` | 天気予報の取得（Open-Meteo の気象庁モデル。緯度経度を小数1桁に丸めて送る・3時間端末に覚える） |
| `src/features/useForecast.ts` | 計画を開いた時に主なエリアの天気予報を取る |
| `src/domain/availability.ts` | 働ける時間（曜日ごとの時間帯・プリセット・週の区間への展開・検証） |
| `src/domain/questPlan.ts` | クエストを軸にした週の組み立て（1時間あたりの件数、計画で届く段階、次の段階まで足す時間とボーナス込みの純時給） |
| `src/domain/continuation.ts` | 続けるか帰るか：追加の利益・増えるレンタル代・追加の時給と GO/WAIT/STOP の判定 |
| `src/domain/planning.ts` | 計画：売上の見込み（本人の実績／参考資料の推計）、候補枠の評価、週の最適な組み合わせ、装備の回収の目安 |
| `src/domain/analytics.ts` | 期間の区切り（日・週・月・年）、内訳、回収の推移、CSV（数式のエスケープ） |
| `src/domain/csv.ts` | CSVの読み取り（引用符・改行・BOM） |
| `src/domain/busyness.ts` | エリアの混み具合：曜日×時間の表（4時区切り）、段階の倍率、区間の積算 |
| `src/domain/leaderboard.ts` | リーダーボード（§5.13）：スクショの文字から順位と件数・賞金だけを読む（名前は捨てる）、順位ごとの終了の時の見込み、上との差、攻める目標の件数 |
| `src/domain/questPush.ts` | 稼働中の「あと何件？」（§5.14）：次の段階・上の順位・攻める目標まで、あと何件・何分、終了予定までに届くか |
| `src/domain/questScreenshot.ts` | クエストの進捗の画面のスクショを文字認識した結果から、期間（または開始の曜日・時刻）と段階（件数は足していく・¥ の読み違いを直す）を読む |
| `src/domain/busyScreenshot.ts` | 配達アプリの「時間帯ごとの傾向」のスクリーンショットから、24本の棒の段階と曜日（画面下の点）を読む。画像は端末の中で読むだけ |
| `src/domain/offer.ts` `offerConfig.ts` | オファー判定：画面の文字の読み取り、実質時給と判定、設定コード（URL に入れる設定。学習した地名の評価も入れる） |
| `src/domain/outlook.ts` | 終了までの見通し：今日のペース（オファーの記録）とこの先の混み具合から、続ける／休憩して再開／エリアを移動／今やめるの利益を比べる |
| `src/domain/townLearning.ts` | 地名の評価の自動学習：受けた配達を終えてから次のオファーまでの待ちを、地名×時間帯ごとに集める |
| `src/storage/offerTransfer.ts` | 持ち帰りコード：Safari に残ったオファーの記録をホーム画面のアプリへ移す |
| `src/domain/cash.ts` | お釣り：出されそうな額、お釣りと渡し方（お札・硬貨の内訳） |
| `src/domain/domain.test.ts` | 受入基準 A01〜A15・A27・A30 のテスト |
| `src/App.tsx` | 画面の枠と下のメニュー（`#home` などのURLで切り替え）、デモ表示の帯 |
| `src/features/Home.tsx` | ホーム：出発・レンタル開始／返却・帰宅して精算、登録したエリアのこの先4時間の混み具合、今月の成績 |
| `src/features/Records.tsx` `SessionForm.tsx` | 記録の一覧・追加・編集・削除（取り消しつき）、計算明細のプレビュー |
| `src/features/Settings.tsx` | 設定：基本・料金（版管理）・固定費・装備と投資・データ |
| `src/features/DataSettings.tsx` | データ：デモ切り替え、バックアップの書き出し・復元、全削除 |
| `src/features/CsvImport.tsx` | データ：CSVから記録を取り込む（見本・確認・まとめて確定） |
| `src/features/Equipment.tsx` | 装備と投資：初級／中級／上級プラン、購入・所有の登録、回収状況 |
| `src/features/Leaderboard.tsx` | 🏆 リーダーボード：クエストごとのまとめ（順位・上との差・攻める目標）と入力（📷 スクショから読み取り・順位と件数・賞金・狙う順位） |
| `src/features/QuestPush.tsx` | 稼働中の「🎯 あと何件？」（🏁 終了までの見通しの中）：この稼働の件数の ＋／−、クエストごとの目標の行 |
| `src/features/QuestCard.tsx` | ホームの「🎯 クエスト」：進み具合の表示・追加・編集・📷 スクショから読み取り |
| `src/features/ocr.ts` | 端末の中の文字認識（tesseract.js・日本語）。必要なファイルは `ocr/` から使う時だけ読み込む |
| `src/features/AreaRoutePlan.tsx` | 計画の「🧭 時間帯ごとのエリア計画」：候補枠を選び、エリアの順番と、ずっと主なエリアにいる場合との差 |
| `src/features/AvailabilitySettings.tsx` | 設定 → 基本の「🕒 働ける時間」：プリセット・曜日ごとの時間帯の編集・1日の最長 |
| `src/features/QuestWeek.tsx` | 計画の「🎯 クエストから見たこの週」：届く段階・足す時間・純時給 |
| `src/features/CashChange.tsx` | ホームの「💴 お釣り」 |
| `src/features/OfferJudge.tsx` | オファー判定（`#offer`。設定でオンの時だけ。手入力の報酬・分・km・届け先の地名で判定。前のショートカットの text=・cfg= も読めるが案内はしない）、判定の基準、持ち帰り／取り込み、地名の評価の一覧 |
| `src/features/AreaSettings.tsx` | 設定・エリア：混み具合の表（マスを押して段階を切り替え・スクショから読み取り）・地名・主なエリア |
| `src/features/OutlookCard.tsx` | ホームの「🏁 終了までの見通し」カード（稼働中だけ表示。終了予定は端末に覚える） |
| `src/features/ContinueCard.tsx` | ホームの「🤔 あと少し続ける？」（30・60・90分延ばした時の GO/WAIT/STOP。畳んで表示） |
| `src/features/Plan.tsx` | 計画：週の稼働量を決める画面。上に WeekBoard とクエスト、「📋 くわしく見る」に3つの見込みの比較・候補枠の一覧・エリアの順番・装備の回収の目安。候補枠の入力 |
| `src/features/WeekBoard.tsx` | 計画の上：⏱️ この週の稼働（量のバー）・🧭 今週の作戦（選択肢）・📅 いつ働くか（7日の帯：天気・作戦・予定・実績・働けない時間、日ごとの作戦の一覧と＋） |
| `src/features/Analytics.tsx` | 分析：期間の成績、売上→利益の内訳、回収の推移、買うか借りるか、所得の目安、内訳表、CSV |
| `src/components/charts.tsx` | 折れ線（なぞると値が出る）と横棒の部品 |
| `src/components/fields.tsx` | 入力欄（整数円・未設定の区別。説明と誤りは読み上げで欄と一緒に読まれる）、エラー表示、「元に戻す」つきのお知らせ |
| `src/format.ts` | 円・時間の表示用の整形（計算はしない） |
| `src/storage/db.ts` | IndexedDB（Dexie）の定義。実績 `deli-kan` とデモ `deli-kan-demo` を分ける |
| `src/storage/schema.ts` | 保存データの形と表示名 |
| `src/storage/repo.ts` | 保存前の検証（時間の重なり・稼働中は1件など）とまとめて書く操作 |
| `src/storage/toDomain.ts` | 保存データ → 計算関数の入力（期間損益・投資回収） |
| `src/storage/presets.ts` `demo.ts` | 料金・装備のプリセット（例）とデモの合成データ |
| `src/storage/backup.ts` | バックアップの書き出し・検証・復元（全体置き換え）・全削除 |
| `src/storage/csvImport.ts` | 独自CSV（v1）の検証・取込済みの判定（external_id と中身）・1回の書き込みでの保存 |
| `src/storage/context.tsx` | 画面からデータベースを使う入口 |
| `src/storage/storage.test.ts` `backup.test.ts` `csvImport.test.ts` | 保存・検証・装備と実績の分離、バックアップと復元、CSVの取り込み（A19）のテスト |
| `e2e/` `playwright.config.ts` | 通しのテスト（Playwright）：主な流れ、データを守る場面、使いやすさ（A23） |
| `src/adapters/` | 外部サービスの入口（天気予報）。候補：シェアサイクルの空き情報・AI |
| `src/pwa.ts` | Service Worker の登録、新しい版の知らせ、オフライン判定、ホーム画面に追加、消えにくい保存の依頼 |
| `src/features/InstallHelp.tsx` | 「アプリとして使う」の案内（設定 → データ） |
| `sw/sw.template.js` | Service Worker のひな形。ビルド時に版と一覧を埋め込んで `dist/sw.js` になる。文字認識のファイル（`ocr/`）は最初の一覧に入れず、使った時に `deli-kan-ocr-v1` に保存する（版が変わっても消さない） |
| `vite.config.ts` | `base`、文字認識のファイル（tesseract.js の worker・core・日本語データ `jpn.traineddata.gz`）を `node_modules` から `ocr/` に置く、`sw.js` を作る |
| `public/` | マニフェスト（`manifest.webmanifest`）とアイコン（`icon.svg` と PNG） |
| `.github/workflows/` | `ci.yml`＝PRのテスト、`pages.yml`＝main を GitHub Pages に公開 |
| `docs/spec/` | 仕様書（`MANIFEST.sha256` で中身を確かめられる）と、収益性の参考資料（全国版） |

## データ

- 保存場所：ブラウザーの IndexedDB（端末を初期化すると消えるので、JSONバックアップを用意する）
- 主なデータ（テーブル）：`settings`（設定。版8でオファー判定の切り替え `offerJudgeEnabled` を追加、未定義は使わない。版11で働ける時間 `availability`、版12で天気の手直し `weatherOverrides`、版13で1日の最長 `maxDayHours` を追加、未定義は制限なし・予報のまま・10時間）、`tariffs`（料金の版）、`sessions`（稼働記録。レンタル・調整・直接経費を中に持つ）、`recurringExpenses`（毎月の固定費）、`plans`（装備プラン）、`assets`（購入・所有した装備）、`slots`（計画の候補枠。版2で追加）、`quests`（クエスト。版3で追加。版10でくり返し `repeat` と回ごとの件数の調整 `offsets` を追加）。版4で記録に取り込み元（`imported`）を追加、`areas`（エリアの混み具合。版5で追加。版9で地図の円の中心 `center` と半径 `radiusM` を追加（未設定なら地図に出さない）。版7で主なエリアからの移動の分 `moveMinutes` と、それをどのエリアから測ったか `moveFromAreaId` を追加。主なエリアが変わったら、その分は使わない）、`offers`（オファーの記録。版6で追加）
- デモ表示の切り替えだけは、端末の表示の好みとして localStorage に覚える
- 金額は整数円、日時は UTC で保存し、表示や週・月の区切りは日本時間（週は月曜始まり）
- 項目の詳細：`docs/spec/docs/03-data-model.md`

## 外部サービス・環境変数

- **OpenStreetMap の地図の画像**（`https://tile.openstreetmap.org/`、2026-10-06 ユーザーが了承）
  - 使うのは、エリアの地図（設定 → エリア → 🗺️ 地図の場所、ホームの 🗺️ 地図で見る）を開いた時だけ
  - 送るのは、見ている辺りの地図の画像の位置（ズームと区画）だけ。記録・設定・現在地は送らない（現在地＝位置情報は使わない。現在地へ地図を動かすと、その辺りの地図の画像を取りに行き、だいたいの現在地が伝わるため）
  - 表示に「© OpenStreetMap contributors」を出す。Service Worker は外のサイトの画像をキャッシュしない（電波がない時は地図の絵が出ない）
  - 地図の部品は Leaflet（`leaflet`）
- **Open-Meteo の天気予報**（`https://api.open-meteo.com/v1/jma`、2026-10-07 ユーザーが了承）
  - 使うのは、計画を開いた時だけ（主なエリアに地図の場所がある時）。3時間は端末（localStorage）に覚えて取り直さない
  - 送るのは、主なエリアの中心を小数1桁（約10km）に丸めた緯度・経度だけ。記録・設定・現在地は送らない
  - 表示に「天気：Open-Meteo（気象庁）」を出す。Service Worker は外のサイトの応答をキャッシュしない（電波がない時は前に覚えた予報か手入力）
- **スクショの文字認識**は外部サービスを使わない：tesseract.js（Apache-2.0）と日本語データ（`@tesseract.js-data/jpn` の best_int、約2MB）を、このアプリと同じ場所の `ocr/` から読み込み、端末の中で動かす。画像も文字も送らない
- 環境変数・APIキーはなし
- 候補：シェアサイクルの公開データ（GBFS。例：HELLO CYCLING）、天気、AIの説明（サーバー経由のみ）

### アプリ更新のキャッシュ（2026-10-08）

- インストール時は `Request` の `cache: reload` でアプリ本体を取り直す。HTTPキャッシュの旧HTMLを新版のキャッシュへ保存しない。
- アプリ本体は現在の版のキャッシュだけから読む。文字認識は専用キャッシュを維持する。
- ビルド時の版にはService Workerのひな形も含め、更新処理だけの変更でもキャッシュを新しくする。
- 切り替えは引き続き利用者が「更新する」を押した時だけ。IndexedDB・localStorageは削除しない。
