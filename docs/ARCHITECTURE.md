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
| `src/domain/continuation.ts` | 続けるか帰るか：追加の利益・増えるレンタル代・追加の時給と GO/WAIT/STOP の判定 |
| `src/domain/planning.ts` | 計画：売上の見込み（本人の実績／参考資料の推計）、候補枠の評価、週の最適な組み合わせ、装備の回収の目安 |
| `src/domain/analytics.ts` | 期間の区切り（日・週・月・年）、内訳、回収の推移、CSV（数式のエスケープ） |
| `src/domain/csv.ts` | CSVの読み取り（引用符・改行・BOM） |
| `src/domain/domain.test.ts` | 受入基準 A01〜A15・A27・A30 のテスト |
| `src/App.tsx` | 画面の枠と下のメニュー（`#home` などのURLで切り替え）、デモ表示の帯 |
| `src/features/Home.tsx` | ホーム：出発・レンタル開始／返却・帰宅して精算、今月の成績 |
| `src/features/Records.tsx` `SessionForm.tsx` | 記録の一覧・追加・編集・削除（取り消しつき）、計算明細のプレビュー |
| `src/features/Settings.tsx` | 設定：基本・料金（版管理）・固定費・装備と投資・データ |
| `src/features/DataSettings.tsx` | データ：デモ切り替え、バックアップの書き出し・復元、全削除 |
| `src/features/CsvImport.tsx` | データ：CSVから記録を取り込む（見本・確認・まとめて確定） |
| `src/features/Equipment.tsx` | 装備と投資：初級／中級／上級プラン、購入・所有の登録、回収状況 |
| `src/features/QuestCard.tsx` | ホームの「🎯 クエスト」：進み具合の表示・追加・編集 |
| `src/features/ContinueCard.tsx` | ホームの「続ける？帰る？」カード（稼働中だけ表示） |
| `src/features/Plan.tsx` | 計画：週の候補枠の入力・おすすめの組み合わせ・3つの見込みの比較・装備の回収の目安 |
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
| `src/adapters/` | （予定・MVP後）シェアサイクルの空き情報・天気・AI |
| `src/pwa.ts` | Service Worker の登録、新しい版の知らせ、オフライン判定、ホーム画面に追加、消えにくい保存の依頼 |
| `src/features/InstallHelp.tsx` | 「アプリとして使う」の案内（設定 → データ） |
| `sw/sw.template.js` | Service Worker のひな形。ビルド時に版と一覧を埋め込んで `dist/sw.js` になる |
| `public/` | マニフェスト（`manifest.webmanifest`）とアイコン（`icon.svg` と PNG） |
| `.github/workflows/` | `ci.yml`＝PRのテスト、`pages.yml`＝main を GitHub Pages に公開 |
| `docs/spec/` | 仕様書（`MANIFEST.sha256` で中身を確かめられる）と、収益性の参考資料（全国版） |

## データ

- 保存場所：ブラウザーの IndexedDB（端末を初期化すると消えるので、JSONバックアップを用意する）
- 主なデータ（テーブル）：`settings`（設定）、`tariffs`（料金の版）、`sessions`（稼働記録。レンタル・調整・直接経費を中に持つ）、`recurringExpenses`（毎月の固定費）、`plans`（装備プラン）、`assets`（購入・所有した装備）、`slots`（計画の候補枠。版2で追加）、`quests`（クエスト。版3で追加）。版4で記録に取り込み元（`imported`）を追加
- デモ表示の切り替えだけは、端末の表示の好みとして localStorage に覚える
- 金額は整数円、日時は UTC で保存し、表示や週・月の区切りは日本時間（週は月曜始まり）
- 項目の詳細：`docs/spec/docs/03-data-model.md`

## 外部サービス・環境変数

- MVP ではなし（外部への送信なし）
- MVP 後の候補：シェアサイクルの公開データ（GBFS。例：HELLO CYCLING）、天気、AIの説明（サーバー経由のみ）
