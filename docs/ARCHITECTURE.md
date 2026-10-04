# しくみ（ARCHITECTURE）

## 全体

```
スマホのブラウザ（PWA：React + TypeScript、Vite でビルド）
   │
   ▼
端末内の保存：IndexedDB（Dexie）
   └ 書き出し：JSONバックアップ・CSV（手動）
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
| `src/domain/domain.test.ts` | 受入基準 A01〜A15・A27・A30 のテスト |
| `src/App.tsx` | 画面の枠と下のメニュー（`#home` などのURLで切り替え） |
| `src/features/` | 画面ごとのまとまり（今は HELLO 料金チェックのみ） |
| `src/format.ts` | 円・時間の表示用の整形（計算はしない） |
| `src/storage/` | （予定）IndexedDB の読み書き、データの版の移行、バックアップ・取込 |
| `src/adapters/` | （予定・MVP後）シェアサイクルの空き情報・天気・AI |
| `.github/workflows/` | `ci.yml`＝PRのテスト、`pages.yml`＝main を GitHub Pages に公開 |
| `docs/spec/` | 引き継ぎ仕様書の原本（`MANIFEST.sha256` で改変がないか確かめられる）と収益性レポート |

## データ

- 保存場所：ブラウザーの IndexedDB（端末を初期化すると消えるので、JSONバックアップを用意する）
- 主なデータ：設定、稼働記録（セッション）、レンタル、経費、装備プラン、購入済み資産、料金の版
- 金額は整数円、日時は UTC で保存し、表示や週・月の区切りは日本時間（週は月曜始まり）
- 項目の詳細：`docs/spec/docs/03-data-model.md`

## 外部サービス・環境変数

- MVP ではなし（外部への送信なし）
- MVP 後の候補：HELLO CYCLING の公開データ（GBFS）、天気、AIの説明（サーバー経由のみ）
