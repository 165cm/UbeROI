# 開発の進め方（Claude Code・Codex 共通）

<!-- 前半（ブランチ〜PRとコミット）は、ひな形 165cm/ai-dev-template と共通。後半（テスト・デプロイ）はリポジトリごとに書く -->

## ブランチと worktree

正本は GitHub のこのリポジトリ。`main` が本番。

- **1タスク＝1ブランチ**。Claude は `claude/…`、Codex は `codex/…` から始める
- 手元で並行して作業する時は、AI ごとに別の worktree（別の作業フォルダ）を使う。同じフォルダを2つのAIに触らせない

```
git fetch origin
git worktree add ../<リポジトリ名>-claude -b claude/<タスク名> origin/main
git worktree add ../<リポジトリ名>-codex  -b codex/<タスク名>  origin/main
```

- 始める前に `docs/CURRENT_TASK.md` の「作業中」に、担当（Claude／Codex）・ブランチ・触るファイルを1行書く。表で相手が触っているファイルは編集しない
- 終わったら、その1行を消して「最近終わったこと」に移す

## PR と公開

1. ブランチで作業 → テスト → コミット → push → PR を作る（`.github/pull_request_template.md` に沿って書く）
2. **ユーザーに「PR #N を本番公開してよいですか？」と確認**。OK が出てからマージ（squash）
3. マージ後、作業ブランチは `origin/main` から作り直す
4. 相互レビュー：片方のAIが作ったPRを、もう片方がレビューしてから公開するとよい（考え方のクセが違うので抜けが見つかりやすい）

## コミット

- Conventional Commits（`feat:` `fix:` `docs:` `refactor:` `test:` など）。本文は日本語で「何を・なぜ」
- 秘密の値・個人情報はコミットしない。秘密の値の設定は、ユーザーに手順（コマンド）を渡して本人にやってもらう
- モデル名をコミット・PR・コードに書かない

---

## テスト（このリポジトリ用）

最初に1回だけ `npm ci`（使う部品のインストール）。そのあと：

```
npm run typecheck
```

```
npm test
```

```
npm run build
```

- 計算ロジックのテストは `src/domain/domain.test.ts`。値は `docs/spec/fixtures/` と受入基準（`docs/spec/docs/07-acceptance.md`）から取る
- PR を出すと GitHub Actions（`.github/workflows/ci.yml`）が同じ3つを自動で実行する
- 画面を変えた時は、スマホ縦（390×844）・320px幅・横・パソコンで確認する

## 手元で動かす

```
npm run dev
```

表示されたURL（`http://localhost:5173/UbeROI/`）をブラウザで開く。

## デプロイ（このリポジトリ用）

`main` にマージすると GitHub Pages に自動で出る（`.github/workflows/pages.yml`）。公開URL：https://165cm.github.io/UbeROI/

最初の1回だけ、GitHub の Settings → Pages → Build and deployment の Source を「GitHub Actions」にする。

## 変更の時に必ずやること（このリポジトリ用）

- 計算式を変える時は、先に `docs/spec/docs/02-profitability.md` との食い違いがないか確かめ、`src/domain/core.ts` の `CALCULATION_VERSION` を上げる
- 保存データの形を変える時は、データの版（schema_version）を上げて移行処理を書く
- 画面から計算式を書かない。必ず `src/domain/` の関数を使う
- Service Worker は本番ビルドだけで動く（`npm run dev` では登録しない）。版は自動で変わるので手で上げなくてよい
- `public/icon.svg` を変えたら、PNG アイコン（192・512・apple-touch-icon 180）も作り直す
- `docs/spec/` を変えたら `MANIFEST.sha256` を作り直す（`docs/spec` で `sha256sum $(awk '{print $2}' MANIFEST.sha256) > MANIFEST.sha256`）。変えた理由は `docs/CURRENT_TASK.md` の決めごとに書く
