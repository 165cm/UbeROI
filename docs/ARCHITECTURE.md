# しくみ（ARCHITECTURE）

## 全体

```
スマホのブラウザ（PWA：React + TypeScript、Vite でビルド）
   │
   ▼
端末内の保存：IndexedDB（Dexie）
   └ 書き出し：JSONバックアップ・CSV（手動）
```

- 公開URL：（GitHub Pages を設定したら書く）
- サーバーはなし。将来、AI説明などでサーバーが必要になったら Google Cloud（Cloud Run 等）に置く
- 詳しい技術仕様：`docs/spec/docs/04-architecture.md`

## ファイルの役割

まだコードはありません。予定している構成（仕様 04 の推奨分割）：

| ファイル・フォルダ | 役割 |
|---|---|
| `src/domain/` | 料金・収益・投資回収・計画の計算（ブラウザーに依存しない純粋関数） |
| `src/storage/` | IndexedDB の読み書き、データの版の移行、バックアップ・取込 |
| `src/features/` | 画面ごとのまとまり（ホーム・記録・分析・計画・設定） |
| `src/adapters/` | 外部データ（シェアサイクルの空き情報・天気・AI）。MVP後 |
| `src/components/` | 金額・時間・状態ラベル・フォームなど共通の部品 |
| `docs/spec/` | 引き継ぎ仕様書の原本（`MANIFEST.sha256` で改変がないか確かめられる）と収益性レポート |

## データ

- 保存場所：ブラウザーの IndexedDB（端末を初期化すると消えるので、JSONバックアップを用意する）
- 主なデータ：設定、稼働記録（セッション）、レンタル、経費、装備プラン、購入済み資産、料金の版
- 金額は整数円、日時は UTC で保存し、表示や週・月の区切りは日本時間（週は月曜始まり）
- 項目の詳細：`docs/spec/docs/03-data-model.md`

## 外部サービス・環境変数

- MVP ではなし（外部への送信なし）
- MVP 後の候補：HELLO CYCLING の公開データ（GBFS）、天気、AIの説明（サーバー経由のみ）
