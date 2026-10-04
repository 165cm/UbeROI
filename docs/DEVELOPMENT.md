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

まだコードがないので、土台を作った時にコマンドを確定する。予定：

```
npm test
```

- 計算ロジックは `docs/spec/fixtures/` と受入基準（`docs/spec/docs/07-acceptance.md`）の値でテストする
- 画面を変えた時は、スマホ縦（390×844）・320px幅・横・パソコンで確認する（Playwright）

## デプロイ（このリポジトリ用）

予定：`main` にマージすると GitHub Pages に自動で出る（`.github/workflows/` に設定を置く）。設定したらここを更新する。

## 変更の時に必ずやること（このリポジトリ用）

- 計算式を変える時は、先に `docs/spec/docs/02-profitability.md` との食い違いがないか確かめ、計算の版（calculation_version）を上げる
- 保存データの形を変える時は、データの版（schema_version）を上げて移行処理を書く
- `docs/spec/` の原本は書き換えない。仕様を変える決めごとは `docs/CURRENT_TASK.md` に書く
